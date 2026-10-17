#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CommonCrypto/CommonDigest.h>
#import <dispatch/dispatch.h>
#import <sys/stat.h>
#import <sys/types.h>
#import <fcntl.h>
#import <limits.h>
#import <unistd.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>
#import <errno.h>
#import <math.h>

#if defined(ELECTRON_MBT_TEST_REAL_WEBKIT_KILL)
// Do not include private WebKit SPI in the production host: this selector is
// exclusively for the CI-only subprocess termination acceptance binary.
static BOOL didRequestRealWebKitKill = NO;
static void requestRealWebKitKill(WKWebView *web) {
  SEL pidSelector = NSSelectorFromString(@"_webProcessIdentifier");
  SEL killSelector = NSSelectorFromString(@"_killWebContentProcess");
  if (![web respondsToSelector:pidSelector] || ![web respondsToSelector:killSelector]) {
    fprintf(stderr, "ELECTRON_MBT_TEST_WEBKIT_SPI_UNAVAILABLE\n");
    fflush(stderr);
    _exit(78);
  }
  pid_t (*processPID)(id, SEL) = (pid_t (*)(id, SEL))[web methodForSelector:pidSelector];
  void (*terminate)(id, SEL) = (void (*)(id, SEL))[web methodForSelector:killSelector];
  pid_t pid = processPID(web, pidSelector);
  if (pid <= 1 || pid == getpid()) {
    fprintf(stderr, "ELECTRON_MBT_TEST_WEBKIT_PID_INVALID\n");
    fflush(stderr);
    _exit(78);
  }
  // Log the actual OS process ID before requesting WebKit's test-only kill;
  // the public navigation delegate, not this function, must emit the event.
  fprintf(stderr, "ELECTRON_MBT_TEST_WEBKIT_KILL_REQUESTED pid=%ld\n", (long)pid);
  fflush(stderr);
  terminate(web, killSelector);
}
#endif


static const uint32_t kMaxFrame = 1048576;
static const int kControlChannel = 3;
static const int kLoadChannel = 4;
static const int kEventChannel = 5;

static BOOL transferBytes(int fd, void *buffer, size_t size, BOOL writing) {
  size_t offset = 0;
  while (offset < size) {
    ssize_t n = writing ? write(fd, (const char *)buffer + offset, size - offset)
                        : read(fd, (char *)buffer + offset, size - offset);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return NO;
    offset += (size_t)n;
  }
  return YES;
}

static NSData *readFrame(int fd) {
  unsigned char header[4];
  if (!transferBytes(fd, header, 4, NO)) return nil;
  uint32_t length = ((uint32_t)header[0] << 24) | ((uint32_t)header[1] << 16) |
                    ((uint32_t)header[2] << 8) | (uint32_t)header[3];
  if (length == 0 || length > kMaxFrame) return nil;
  void *buffer = malloc(length);
  if (!buffer) return nil;
  BOOL ok = transferBytes(fd, buffer, length, NO);
  if (!ok) { free(buffer); return nil; }
  return [NSData dataWithBytesNoCopy:buffer length:length freeWhenDone:YES];
}

static BOOL writeFrame(int fd, NSDictionary *message) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:&error];
  if (error || !data || data.length > kMaxFrame) return NO;
  uint32_t length = (uint32_t)data.length;
  unsigned char header[4] = {(unsigned char)(length >> 24), (unsigned char)(length >> 16),
                             (unsigned char)(length >> 8), (unsigned char)length};
  return transferBytes(fd, header, 4, YES) && transferBytes(fd, (void *)data.bytes, length, YES);
}

static NSDictionary *readWindowBounds(NSWindow *native, NSScreen *primary) {
  if (!native || !primary) return nil;
  NSRect frame = native.frame;
  NSRect display = primary.frame;
  double x = round(NSMinX(frame) - NSMinX(display));
  double y = round(NSMaxY(display) - NSMaxY(frame));
  double width = round(NSWidth(frame));
  double height = round(NSHeight(frame));
  if (!isfinite(x) || !isfinite(y) || !isfinite(width) || !isfinite(height) ||
      fabs(x) > 1048576.0 || fabs(y) > 1048576.0 ||
      width <= 0.0 || width > 32768.0 || height <= 0.0 || height > 32768.0) return nil;
  return @{@"x": @(llround(x)), @"y": @(llround(y)),
           @"width": @(llround(width)), @"height": @(llround(height))};
}

static NSString *canonicalPath(NSString *path) {
  if (![path isKindOfClass:[NSString class]] || ![path isAbsolutePath]) return nil;
  char resolved[PATH_MAX];
  if (!realpath(path.fileSystemRepresentation, resolved)) return nil;
  return [NSString stringWithUTF8String:resolved];
}

static NSString *jsQuotedString(NSString *value) {
  if (![value isKindOfClass:[NSString class]]) return nil;
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:@[value] options:0 error:&error];
  NSString *encoded = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  if (error || encoded.length < 2) return nil;
  NSString *quoted = [encoded substringWithRange:NSMakeRange(1, encoded.length - 2)];
  // U+2028/U+2029 are valid JSON but terminate a JavaScript string literal.
  NSString *lineSeparator = [NSString stringWithFormat:@"%C", (unichar)0x2028];
  NSString *paragraphSeparator = [NSString stringWithFormat:@"%C", (unichar)0x2029];
  quoted = [quoted stringByReplacingOccurrencesOfString:lineSeparator withString:@"\\u2028"];
  quoted = [quoted stringByReplacingOccurrencesOfString:paragraphSeparator withString:@"\\u2029"];
  return quoted;
}

static const NSUInteger MaxSnapshotBytes = 1048576;
static const NSUInteger MaxSourceManifestBytes = 65536;

static BOOL safeRelativePath(NSString *path) {
  if (![path isKindOfClass:[NSString class]] || path.length == 0 || path.length > 256 ||
      [path isAbsolutePath]) return NO;
  for (NSString *component in [path pathComponents]) {
    if ([component isEqualToString:@".."] || [component isEqualToString:@"."]) return NO;
  }
  return YES;
}

static BOOL validSHA256(NSString *value) {
  if (![value isKindOfClass:[NSString class]] || value.length != 64) return NO;
  for (NSUInteger index = 0; index < 64; index++) {
    unichar character = [value characterAtIndex:index];
    if (!((character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f'))) return NO;
  }
  return YES;
}

static NSDictionary *readSourceManifest(NSString *root, NSData **outData) {
  NSString *manifestPath = [root stringByAppendingPathComponent:@"source-manifest.json"];
  NSString *canonical = canonicalPath(manifestPath);
  if (!canonical || ![canonical hasPrefix:[root stringByAppendingString:@"/"]]) return nil;
  struct stat info;
  if (stat(canonical.fileSystemRepresentation, &info) != 0 || !S_ISREG(info.st_mode) ||
      info.st_size <= 0 || info.st_size > (off_t)MaxSourceManifestBytes) return nil;
  NSData *data = [NSData dataWithContentsOfFile:canonical];
  if (!data || data.length == 0 || data.length > MaxSourceManifestBytes) return nil;
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![value isKindOfClass:[NSDictionary class]]) return nil;
  if (outData != NULL) *outData = data;
  return value;
}

static NSColor *windowBackgroundColor(NSString *value) {
  if (![value isKindOfClass:[NSString class]] || value.length != 7 || ![value hasPrefix:@"#"]) return nil;
  NSString *hex = [value substringFromIndex:1];
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  unsigned long long raw = 0;
  if (![scanner scanHexLongLong:&raw] || !scanner.isAtEnd || raw > 0xffffffULL) return nil;
  return [NSColor colorWithSRGBRed:((raw >> 16) & 0xff) / 255.0
                              green:((raw >> 8) & 0xff) / 255.0
                               blue:(raw & 0xff) / 255.0
                              alpha:1.0];
}

static NSString *windowBackgroundHex(NSColor *color) {
  NSColor *srgb = [color colorUsingColorSpace:[NSColorSpace sRGBColorSpace]];
  if (!srgb) return nil;
  double red = fmin(1.0, fmax(0.0, srgb.redComponent));
  double green = fmin(1.0, fmax(0.0, srgb.greenComponent));
  double blue = fmin(1.0, fmax(0.0, srgb.blueComponent));
  return [NSString stringWithFormat:@"#%02x%02x%02x",
    (unsigned)lround(red * 255.0), (unsigned)lround(green * 255.0), (unsigned)lround(blue * 255.0)];
}

static NSString *preloadDigest(NSData *data) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  char hex[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  static const char digits[] = "0123456789abcdef";
  for (NSUInteger i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
    hex[i * 2] = digits[digest[i] >> 4];
    hex[i * 2 + 1] = digits[digest[i] & 15];
  }
  hex[CC_SHA256_DIGEST_LENGTH * 2] = '\0';
  return [NSString stringWithUTF8String:hex];
}

@interface MBTWindow : NSObject <WKNavigationDelegate, NSWindowDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply>
@property(nonatomic, strong) NSWindow *native;
@property(nonatomic, strong) WKWebView *web;
@property(nonatomic, strong) WKContentWorld *bootstrapWorld;
@property(nonatomic, strong) WKContentWorld *preloadWorld;
@property(nonatomic, copy) NSString *bootstrapNonce;
@property(nonatomic, copy) NSString *preloadNonce;
@property(nonatomic) long long bootstrapObservedGeneration;
@property(nonatomic) long long bootstrapNotifiedGeneration;
@property(nonatomic, copy) void (^bootstrapAttested)(long long);
@property(nonatomic) long long preloadObservedGeneration;
@property(nonatomic, copy) NSString *preloadSource;
@property(nonatomic, copy) NSString *adaptedAdapterSource;
@property(nonatomic, copy) NSString *adaptedAdapterNonce;
@property(nonatomic, copy) NSString *adaptedEventNonce;
@property(nonatomic) long long adaptedAdapterObservedGeneration;
@property(nonatomic) BOOL adaptedAdapterBeforeLoad;
@property(nonatomic, copy) NSString *preloadStatus;
@property(nonatomic, copy) NSString *preloadDetail;
@property(nonatomic, copy) NSString *preloadLastStatus;
@property(nonatomic, copy) NSString *preloadLastDetail;
@property(nonatomic) long long preloadFinishedGeneration;
@property(nonatomic, copy) NSString *root;
@property(nonatomic, copy) NSString *loadedFile;
@property(nonatomic, copy) void (^loadDone)(BOOL, NSString *);
@property(nonatomic, copy) void (^contentGone)(long long);
@property(nonatomic, copy) long long (^closeRequested)(long long);
@property(nonatomic) BOOL closeRequestOutstanding;
@property(nonatomic) long long closeRequestEventID;
@property(nonatomic) long long generation;
@property(nonatomic) long long loadedGeneration;
@property(nonatomic, strong) WKNavigation *loadingNavigation;
@property(nonatomic) long long loadingNavigationGeneration;
#if defined(ELECTRON_MBT_TEST_STALE_NAVIGATION_CALLBACK)
@property(nonatomic, strong) WKNavigation *testingRetiredNavigation;
@property(nonatomic) BOOL testingStaleNavigationCallbackScheduled;
@property(nonatomic) NSUInteger testingStaleNavigationCallbackCount;
#endif
@property(nonatomic) BOOL permittedClose;
@property(nonatomic) BOOL allowNextNavigation;
@property(nonatomic) BOOL contentAlive;
@property(nonatomic, copy) NSString *snapshotSourceFile;
@property(nonatomic, copy) NSString *snapshotRoot;
@property(nonatomic, copy) NSString *snapshotFile;
@property(nonatomic, copy) NSString *snapshotSHA256;
@property(nonatomic) long long snapshotBytes;
@property(nonatomic, copy) NSDictionary<NSString *, NSString *> *snapshotFiles;
@property(nonatomic, copy) NSString *snapshotManifestSHA256;
@property(nonatomic) long long ingressAdmitted;
@property(nonatomic) long long ingressDenied;
@property(nonatomic, copy) NSString *ingressLastCode;
- (instancetype)initWithRoot:(NSString *)root width:(NSInteger)width height:(NSInteger)height
                       title:(NSString *)title visible:(BOOL)visible
                  preloadSource:(NSString *)preloadSource;
- (void)publishVerifiedBootstrapIfReady;
- (void)clearSnapshot;
- (void)tearDown;
@end

@implementation MBTWindow
- (instancetype)initWithRoot:(NSString *)root width:(NSInteger)width height:(NSInteger)height
                       title:(NSString *)title visible:(BOOL)visible
                  preloadSource:(NSString *)preloadSource {
  self = [super init];
  if (self) {
    self.root = root;
    self.preloadSource = preloadSource;
    self.adaptedAdapterSource = nil;
    self.adaptedAdapterNonce = nil;
    self.adaptedEventNonce = nil;
    self.adaptedAdapterObservedGeneration = 0;
    self.adaptedAdapterBeforeLoad = NO;
    self.snapshotSourceFile = nil;
    self.snapshotRoot = nil;
    self.snapshotFile = nil;
    self.snapshotSHA256 = nil;
    self.snapshotBytes = 0;
    self.snapshotFiles = nil;
    self.snapshotManifestSHA256 = nil;
    self.ingressAdmitted = 0;
    self.ingressDenied = 0;
    self.ingressLastCode = nil;
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
    config.userContentController = [[WKUserContentController alloc] init];
    self.bootstrapWorld = [WKContentWorld worldWithName:@"electron.mbt.bootstrap"];
    [config.userContentController addScriptMessageHandlerWithReply:self
      contentWorld:self.bootstrapWorld name:@"electronMbtBootstrap"];
    if (self.preloadSource) {
      self.preloadWorld = [WKContentWorld worldWithName:@"electron.mbt.preload"];
      [config.userContentController addScriptMessageHandlerWithReply:self
        contentWorld:self.preloadWorld name:@"electronMbtPreloadResult"];
    }
    NSWindowStyleMask styleMask = NSWindowStyleMaskTitled |
      NSWindowStyleMaskClosable | NSWindowStyleMaskResizable;
    // Do not pass Electron's outer width/height directly as content dimensions:
    // the titled NSWindow frame would then grow by its title-bar height.
    NSRect contentRect = [NSWindow contentRectForFrameRect:
      NSMakeRect(0, 0, width, height) styleMask:styleMask];
    self.web = [[WKWebView alloc] initWithFrame:
      NSMakeRect(0, 0, NSWidth(contentRect), NSHeight(contentRect))
      configuration:config];
    self.web.navigationDelegate = self;
    self.web.UIDelegate = self;
    // The native close button never destroys the window without a matching
    // MoonBit/Node main-process cancellation decision and native close ACK.
    self.native = [[NSWindow alloc] initWithContentRect:contentRect
      styleMask:styleMask backing:NSBackingStoreBuffered defer:NO];
    self.native.releasedWhenClosed = NO;
    self.native.delegate = self;
    self.native.contentView = self.web;
    self.native.title = title;
    self.generation = 0;
    self.loadedGeneration = 0;
    self.loadingNavigationGeneration = 0;
    self.bootstrapObservedGeneration = 0;
    self.bootstrapNotifiedGeneration = 0;
    self.preloadObservedGeneration = 0;
    self.preloadFinishedGeneration = 0;
    self.preloadStatus = nil;
    self.preloadDetail = nil;
    self.preloadLastStatus = nil;
    self.preloadLastDetail = nil;
    self.contentAlive = YES;
    self.allowNextNavigation = NO;
    self.closeRequestOutstanding = NO;
    self.closeRequestEventID = 0;
    if (visible) [self.native orderFront:nil];
  }
  return self;
}
- (void)clearSnapshot {
  if (self.snapshotRoot != nil) {
    [[NSFileManager defaultManager] removeItemAtPath:self.snapshotRoot error:nil];
  }
  self.snapshotSourceFile = nil;
  self.snapshotRoot = nil;
  self.snapshotFile = nil;
  self.snapshotSHA256 = nil;
  self.snapshotBytes = 0;
  self.snapshotFiles = nil;
  self.snapshotManifestSHA256 = nil;
}
- (void)installBootstrapScript {
  // Bootstrap attestation is issued by a different JS realm from the app's
  // preload. The app can use DOM, but cannot call this privileged handler.
  self.bootstrapNonce = [[NSUUID UUID] UUIDString];
  self.bootstrapObservedGeneration = 0;
  self.preloadNonce = self.preloadSource ? [[NSUUID UUID] UUIDString] : nil;
  self.preloadObservedGeneration = 0;
  self.preloadFinishedGeneration = 0;
  self.preloadStatus = nil;
  self.preloadDetail = nil;
  self.adaptedAdapterNonce = nil;
  self.adaptedEventNonce = nil;
  self.adaptedAdapterObservedGeneration = 0;
  self.adaptedAdapterBeforeLoad = NO;
  WKUserContentController *controller = self.web.configuration.userContentController;
  [controller removeAllUserScripts];
  NSString *bootstrapSource = [NSString stringWithFormat:
    @"void window.webkit.messageHandlers.electronMbtBootstrap.postMessage({nonce:'%@'}).catch(() => {});",
    self.bootstrapNonce];
  WKUserScript *bootstrap = [[WKUserScript alloc] initWithSource:bootstrapSource
    injectionTime:WKUserScriptInjectionTimeAtDocumentStart
    forMainFrameOnly:YES inContentWorld:self.bootstrapWorld];
  [controller addUserScript:bootstrap];
  if (self.adaptedAdapterSource) {
    // The host object only installs a nonce-bound page dispatcher for fixed
    // topics. It grants no native ingress, and the adapter deletes the global
    // handoff before any page script can read it.
    self.adaptedEventNonce = [[NSUUID UUID] UUIDString];
    NSString *hostSource = [NSString stringWithFormat:
      @"(function (__adaptedEventNonce) {\n"
       "const host = Object.freeze({\n"
       "  onEvent: function (emit) {\n"
       "    Object.defineProperty(window, '__electronMbtDispatch', {\n"
       "      value: function (nonce, topic, payload) {\n"
       "        if (nonce !== __adaptedEventNonce) {\n"
       "          throw new Error('ELECTRON_MBT_ADAPTER_EVENT_DENIED');\n"
       "        }\n"
       "        emit(topic, payload);\n"
       "      },\n"
       "      enumerable: false, configurable: false, writable: false\n"
       "    });\n"
       "  }\n"
       "});\n"
       "Object.defineProperty(window, '__electronMbtIngress', {\n"
       "  value: host, enumerable: false, configurable: true, writable: false\n"
       "});\n"
       "})(\"%@\");",
      self.adaptedEventNonce];
    WKUserScript *host = [[WKUserScript alloc] initWithSource:hostSource
      injectionTime:WKUserScriptInjectionTimeAtDocumentStart
      forMainFrameOnly:YES inContentWorld:[WKContentWorld pageWorld]];
    [controller addUserScript:host];
    // The pinned adapter body is wrapped only to carry a per-document nonce and
    // report its document-start execution. The nonce is lexical, so page scripts
    // cannot replay the installation observation, and the observation grants no
    // ingress authority.
    self.adaptedAdapterNonce = [[NSUUID UUID] UUIDString];
    NSString *wrapped = [NSString stringWithFormat:
      @"(function (__electronMbtAdapterNonce) {\n%@\n"
       "try {"
       "const handler = window.webkit && window.webkit.messageHandlers && "
       "window.webkit.messageHandlers.electronMbtAdapterInstalled;"
       "if (handler) {"
       "const reply = handler.postMessage({nonce: __electronMbtAdapterNonce});"
       "if (reply && reply.catch) reply.catch(function () {});"
       "}"
       "} catch (_) {}\n"
       "})(\"%@\");",
      self.adaptedAdapterSource, self.adaptedAdapterNonce];
    WKUserScript *adapted = [[WKUserScript alloc] initWithSource:wrapped
      injectionTime:WKUserScriptInjectionTimeAtDocumentStart
      forMainFrameOnly:YES inContentWorld:[WKContentWorld pageWorld]];
    [controller addUserScript:adapted];
  }
  if (self.preloadSource) {
    NSError *error = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:@[self.preloadSource]
      options:0 error:&error];
    NSString *encoded = json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : nil;
    if (error || encoded.length < 2) return;
    NSString *quoted = [encoded substringWithRange:NSMakeRange(1, encoded.length - 2)];
    // Only a status reporter exists in the preload realm. It must not gain
    // the separate bootstrap realm's handler or nonce.
    NSString *preloadScriptSource = [NSString stringWithFormat:
      @"(function(){"
       "const h=window.webkit.messageHandlers.electronMbtPreloadResult;"
       "const report=h.postMessage.bind(h);"
       "let status='ok',requestedUnsupported=false,detail='';"
       "const record=function(api){requestedUnsupported=true;detail=api;"
       "throw {code:'ELECTRON_MBT_REQUIRE_UNSUPPORTED'};};"
       "const stub=function(prefix){return new Proxy(function(){}, {get:function(_target,key){"
       "return function(){return record(prefix+'.'+String(key));};}});};"
       "const electron={contextBridge:stub('contextBridge'),ipcRenderer:stub('ipcRenderer'),"
       "webUtils:stub('webUtils')};"
       "const require=function(name){if(name==='electron'){requestedUnsupported=true;"
       "if(!detail)detail='require:electron';return electron;}"
       "return record('require:'+name);};"
       "try{const module={exports:{}};"
       "(new Function('require','module','exports',%@))(require,module,module.exports);}"
       "catch(error){status=error&&error.code==='ELECTRON_MBT_REQUIRE_UNSUPPORTED'?"
       "'unsupported':'failed';}"
       "if(requestedUnsupported)status='unsupported';"
       "report({nonce:'%@',preload:status,detail:detail.slice(0,128)}).catch(function(){});"
       "})();",
      quoted, self.preloadNonce];
    WKUserScript *preload = [[WKUserScript alloc] initWithSource:preloadScriptSource
      injectionTime:WKUserScriptInjectionTimeAtDocumentStart
      forMainFrameOnly:YES inContentWorld:self.preloadWorld];
    [controller addUserScript:preload];
  }
}
- (void)userContentController:(WKUserContentController *)controller
    didReceiveScriptMessage:(WKScriptMessage *)message
    replyHandler:(void (^)(id _Nullable, NSString * _Nullable))replyHandler {
  NSDictionary *body = [message.body isKindOfClass:[NSDictionary class]] ? message.body : nil;
  NSString *nonce = body[@"nonce"];
  NSURL *url = message.frameInfo.request.URL;
  NSString *file = url.isFileURL ? canonicalPath(url.path) : nil;
  BOOL common = controller == self.web.configuration.userContentController &&
    message.webView == self.web && self.contentAlive &&
    self.generation > 0 && self.generation == self.loadedGeneration &&
    self.loadedFile != nil && message.frameInfo.isMainFrame &&
    [nonce isKindOfClass:[NSString class]] &&
    [file isEqualToString:self.loadedFile];
  if ([message.name isEqualToString:@"electronMbtApp"]) {
    NSDictionary *request = [message.body isKindOfClass:[NSDictionary class]] ? message.body : nil;
    BOOL mainFrame = message.frameInfo.isMainFrame;
    BOOL pageWorld = message.world == [WKContentWorld pageWorld];
    NSURL *requestURL = message.frameInfo.request.URL;
    NSString *requestFile = requestURL.isFileURL ? canonicalPath(requestURL.path) : nil;
    BOOL current = controller == self.web.configuration.userContentController &&
      message.webView == self.web && self.contentAlive &&
      self.generation > 0 && self.generation == self.loadedGeneration &&
      self.loadedFile != nil && requestFile != nil &&
      [requestFile isEqualToString:self.loadedFile] &&
      self.adaptedAdapterObservedGeneration == self.generation;
    if (!mainFrame || !pageWorld || !current) {
      self.ingressDenied++;
      self.ingressLastCode = @"ELECTRON_MBT_INGRESS_DENIED";
      replyHandler(nil, @"ELECTRON_MBT_INGRESS_DENIED");
      return;
    }
    NSString *operation = request[@"operation"];
    id requestPayload = request[@"payload"];
    if (request == nil || request.count != 2 || ![operation isKindOfClass:[NSString class]] ||
        ![requestPayload isKindOfClass:[NSDictionary class]]) {
      self.ingressDenied++;
      self.ingressLastCode = @"ELECTRON_MBT_INGRESS_MALFORMED";
      replyHandler(nil, @"ELECTRON_MBT_INGRESS_MALFORMED");
      return;
    }
    if (![operation isEqualToString:@"selftest:identity"]) {
      self.ingressDenied++;
      self.ingressLastCode = @"ELECTRON_MBT_INGRESS_UNKNOWN_OPERATION";
      replyHandler(nil, @"ELECTRON_MBT_INGRESS_UNKNOWN_OPERATION");
      return;
    }
    NSDictionary *payload = requestPayload;
    BOOL limited = payload.count <= 1;
    for (id value in payload.allValues) {
      if ([value isKindOfClass:[NSString class]]) {
        limited = limited && [value length] <= 256;
      } else if ([value isKindOfClass:[NSNumber class]]) {
        limited = limited &&
          (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID() ||
           isfinite([value doubleValue]));
      } else {
        limited = NO;
      }
    }
    if (!limited) {
      self.ingressDenied++;
      self.ingressLastCode = @"ELECTRON_MBT_INGRESS_LIMIT";
      replyHandler(nil, @"ELECTRON_MBT_INGRESS_LIMIT");
      return;
    }
    self.ingressAdmitted++;
    replyHandler(@{
      @"admitted": @YES,
      @"operation": operation,
      @"sender": @"native-wkwebview",
      @"mainFrame": @YES,
      @"generation": @(self.generation),
      @"source": self.snapshotFile != nil ? @"snapshot" : @"app",
      @"entrySHA256": self.snapshotSHA256 ?: @"",
      @"manifestSHA256": self.snapshotManifestSHA256 ?: @"",
    }, nil);
    return;
  }
  BOOL bootstrap = common && [message.name isEqualToString:@"electronMbtBootstrap"] &&
    body.count == 1 && self.bootstrapNonce != nil &&
    self.bootstrapObservedGeneration != self.generation &&
    [nonce isEqualToString:self.bootstrapNonce];
  NSString *preloadResult = body[@"preload"];
  NSString *preloadDetail = body[@"detail"];
  BOOL preload = common && self.preloadSource != nil &&
    [message.name isEqualToString:@"electronMbtPreloadResult"] &&
    body.count == 3 && self.preloadNonce != nil &&
    self.preloadObservedGeneration != self.generation &&
    [nonce isEqualToString:self.preloadNonce] &&
    [preloadResult isKindOfClass:[NSString class]] &&
    [@[@"ok", @"unsupported", @"failed"] containsObject:preloadResult] &&
    [preloadDetail isKindOfClass:[NSString class]] && preloadDetail.length <= 128;
  BOOL adapted = common && [message.name isEqualToString:@"electronMbtAdapterInstalled"] &&
    body.count == 1 && self.adaptedAdapterNonce != nil &&
    self.adaptedAdapterObservedGeneration != self.generation &&
    [nonce isEqualToString:self.adaptedAdapterNonce] &&
    message.world == [WKContentWorld pageWorld];
  if (!bootstrap && !preload && !adapted) {
    replyHandler(nil, @"ELECTRON_MBT_BOOTSTRAP_DENIED");
    return;
  }
  if (adapted) {
    // This is an installation observation only. It proves the pinned adapter
    // body ran at document-start before LoadComplete; it is not a sender grant
    // or permission for any later page message.
    self.adaptedAdapterObservedGeneration = self.generation;
    self.adaptedAdapterBeforeLoad = self.loadDone != nil;
    replyHandler(@{@"ok": @YES}, nil);
    return;
  }
  if (bootstrap) self.bootstrapObservedGeneration = self.generation;
  else {
    self.preloadObservedGeneration = self.generation;
    self.preloadStatus = preloadResult;
    self.preloadDetail = preloadDetail;
  }
  replyHandler(@{@"ok": @YES}, nil);
  if (self.preloadSource && self.preloadFinishedGeneration == self.generation) {
    [self completeVerifiedPreload];
  }
  [self publishVerifiedBootstrapIfReady];
}
- (void)publishVerifiedBootstrapIfReady {
  NSURL *url = self.web.URL;
  NSString *canonical = url.isFileURL ? canonicalPath(url.path) : nil;
  if (!self.contentAlive || self.generation <= 0 ||
      self.loadedGeneration != self.generation ||
      self.bootstrapObservedGeneration != self.generation ||
      self.bootstrapNotifiedGeneration == self.generation ||
      self.bootstrapNonce == nil || self.loadedFile == nil ||
      self.loadDone != nil || self.loadingNavigation != nil ||
      (self.preloadSource != nil && (self.preloadObservedGeneration != self.generation ||
        self.preloadNonce == nil || ![self.preloadStatus isEqualToString:@"ok"])) ||
      ![canonical isEqualToString:self.loadedFile]) return;
  // The app preload realm cannot attest itself; only the independent native
  // bootstrap and the successful restricted preload can produce this event.
  // Neither attests a later page-world message initiator.
  self.bootstrapNotifiedGeneration = self.generation;
  if (self.bootstrapAttested) self.bootstrapAttested(self.generation);
}
- (NSDictionary *)bootstrapStatus {
  NSURL *url = self.web.URL;
  NSString *file = url.isFileURL ? canonicalPath(url.path) : nil;
  BOOL observed = self.contentAlive && self.generation > 0 &&
    self.loadedGeneration == self.generation &&
    self.bootstrapObservedGeneration == self.generation &&
    self.bootstrapNonce != nil &&
    (!self.preloadSource || (self.preloadObservedGeneration == self.generation &&
     [self.preloadStatus isEqualToString:@"ok"])) &&
    self.loadDone == nil &&
    self.loadingNavigation == nil && self.loadedFile != nil &&
    [file isEqualToString:self.loadedFile];
  return @{@"observed": @(observed), @"mainFrame": @(observed),
    @"generation": @(self.generation),
    @"documentURL": observed ? url.absoluteString : @""};
}
- (BOOL)withinRoot:(NSString *)path {
  NSString *canonical = canonicalPath(path);
  if (!canonical) return NO;
  return [canonical hasPrefix:[self.root stringByAppendingString:@"/"]];
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
  (void)sender;
  if (self.permittedClose) return YES;
  // AppKit delegate callbacks run on the UI thread. Never synchronously
  // consult a Node event handler from here (which could deadlock the host).
  if (!self.closeRequestOutstanding) {
    self.closeRequestOutstanding = YES;
    // Retain the exact monotonic native event token even if the notification
    // is still queued when Node independently cancels the same close.
    if (self.closeRequested) self.closeRequestEventID = self.closeRequested(self.generation);
  }
  return NO;
}
- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  NSURL *url = action.request.URL;
  NSString *canonical = url.isFileURL ? canonicalPath(url.path) : nil;
  BOOL allowed = self.allowNextNavigation && self.contentAlive &&
                 action.targetFrame.isMainFrame && self.loadedFile != nil &&
                 [canonical isEqualToString:self.loadedFile];
  // An unrequested reload creates a new document without MoonBit generation
  // revocation. Reject it instead of allowing stale callback authority.
  if (allowed) self.allowNextNavigation = NO;
  decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (nullable WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
    forNavigationAction:(WKNavigationAction *)action
    windowFeatures:(WKWindowFeatures *)windowFeatures {
  (void)webView; (void)configuration; (void)action; (void)windowFeatures;
  return nil;
}
- (void)completeLoad:(BOOL)ok reason:(NSString *)reason {
  void (^done)(BOOL, NSString *) = self.loadDone;
  self.loadDone = nil;
  self.loadingNavigation = nil;
  self.loadingNavigationGeneration = 0;
  if (!ok) {
    self.bootstrapNonce = nil;
    self.bootstrapObservedGeneration = 0;
    self.preloadNonce = nil;
    self.preloadObservedGeneration = 0;
    self.preloadStatus = nil;
  }
  self.preloadFinishedGeneration = 0;
  if (ok) [self publishVerifiedBootstrapIfReady];
  if (done) done(ok, reason);
}
- (BOOL)isCurrentLoadNavigation:(WKNavigation *)navigation {
  return navigation != nil && navigation == self.loadingNavigation &&
         self.loadingNavigationGeneration > 0 &&
         self.loadingNavigationGeneration == self.generation &&
         self.loadedGeneration == self.generation &&
         self.contentAlive && self.loadDone != nil;
}
- (void)completeLoad:(BOOL)ok reason:(NSString *)reason
      forNavigation:(WKNavigation *)navigation {
  if (![self isCurrentLoadNavigation:navigation]) return;
  [self completeLoad:ok reason:reason];
}
- (void)completeVerifiedPreload {
  if (!self.preloadSource || self.preloadFinishedGeneration != self.generation ||
      self.bootstrapObservedGeneration != self.generation ||
      self.preloadObservedGeneration != self.generation ||
      ![self isCurrentLoadNavigation:self.loadingNavigation]) return;
  self.preloadLastStatus = self.preloadStatus;
  self.preloadLastDetail = self.preloadDetail;
  NSString *reason = [self.preloadStatus isEqualToString:@"ok"] ? @"" :
    ([self.preloadStatus isEqualToString:@"unsupported"] ?
     @"ELECTRON_MBT_PRELOAD_UNSUPPORTED_API" : @"ELECTRON_MBT_PRELOAD_FAILED");
  [self completeLoad:(reason.length == 0) reason:reason];
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)webView;
  if (![self isCurrentLoadNavigation:navigation]) return;
#if defined(ELECTRON_MBT_TEST_STALE_NAVIGATION_CALLBACK)
  if (!self.testingRetiredNavigation) self.testingRetiredNavigation = navigation;
#endif
  if (self.preloadSource) {
    self.preloadFinishedGeneration = self.generation;
    [self completeVerifiedPreload];
    if ([self isCurrentLoadNavigation:navigation]) {
      __weak MBTWindow *weakWindow = self;
      long long loadGeneration = self.generation;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                     dispatch_get_main_queue(), ^{
        MBTWindow *window = weakWindow;
        if (window && window.generation == loadGeneration &&
            window.preloadFinishedGeneration == loadGeneration &&
            [window isCurrentLoadNavigation:navigation]) {
          [window completeLoad:NO reason:@"ELECTRON_MBT_PRELOAD_NOT_VERIFIED"
                   forNavigation:navigation];
        }
      });
    }
  } else {
    [self completeLoad:YES reason:@"" forNavigation:navigation];
  }
#if defined(ELECTRON_MBT_TEST_TERMINATION_CALLBACK)
  // A separate CI-only binary invokes the public delegate callback, not
  // a real WebKit subprocess kill. It tests event/revocation plumbing only.
  __weak MBTWindow *weakWindow = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC),
                 dispatch_get_main_queue(), ^{
    MBTWindow *window = weakWindow;
    if (window && window.contentAlive) {
      [window webViewWebContentProcessDidTerminate:window.web];
    }
  });
#endif
#if defined(ELECTRON_MBT_TEST_REAL_WEBKIT_KILL)
  if (!didRequestRealWebKitKill) {
    didRequestRealWebKitKill = YES;
    __weak MBTWindow *weakWindow = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 700 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
      MBTWindow *window = weakWindow;
      if (window && window.contentAlive) requestRealWebKitKill(window.web);
    });
  }
#endif
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation
      withError:(NSError *)error {
  (void)webView; (void)error;
  [self completeLoad:NO reason:@"ELECTRON_MBT_LOAD_FAILED" forNavigation:navigation];
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation
      withError:(NSError *)error {
  (void)webView; (void)error;
  [self completeLoad:NO reason:@"ELECTRON_MBT_LOAD_FAILED" forNavigation:navigation];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  (void)webView;
  BOOL newlyTerminated = self.contentAlive;
  self.contentAlive = NO;
  self.allowNextNavigation = NO;
  self.bootstrapNonce = nil;
  self.bootstrapObservedGeneration = 0;
  self.preloadNonce = nil;
  self.preloadObservedGeneration = 0;
  self.preloadStatus = nil;
  self.preloadFinishedGeneration = 0;
  self.adaptedAdapterSource = nil;
  self.adaptedAdapterNonce = nil;
  self.adaptedEventNonce = nil;
  self.adaptedAdapterObservedGeneration = 0;
  self.adaptedAdapterBeforeLoad = NO;
  [self clearSnapshot];
  [self completeLoad:NO reason:@"ELECTRON_MBT_WEB_PROCESS_TERMINATED"];
  if (newlyTerminated && self.contentGone) self.contentGone(self.generation);
}
- (void)tearDown {
  self.contentAlive = NO;
  self.closeRequestOutstanding = NO;
  self.closeRequestEventID = 0;
  self.closeRequested = nil;
  self.bootstrapAttested = nil;
  self.bootstrapNonce = nil;
  self.bootstrapObservedGeneration = 0;
  self.preloadNonce = nil;
  self.preloadObservedGeneration = 0;
  self.preloadStatus = nil;
  self.preloadFinishedGeneration = 0;
  self.adaptedAdapterSource = nil;
  self.adaptedAdapterNonce = nil;
  self.adaptedEventNonce = nil;
  self.adaptedAdapterObservedGeneration = 0;
  self.adaptedAdapterBeforeLoad = NO;
  [self clearSnapshot];
  [self.web.configuration.userContentController removeAllUserScripts];
  [self.web.configuration.userContentController
    removeScriptMessageHandlerForName:@"electronMbtBootstrap" contentWorld:self.bootstrapWorld];
  [self.web.configuration.userContentController
    removeScriptMessageHandlerForName:@"electronMbtAdapterInstalled"
    contentWorld:[WKContentWorld pageWorld]];
  [self.web.configuration.userContentController
    removeScriptMessageHandlerForName:@"electronMbtApp"
    contentWorld:[WKContentWorld pageWorld]];
  if (self.preloadWorld) {
    [self.web.configuration.userContentController
      removeScriptMessageHandlerForName:@"electronMbtPreloadResult" contentWorld:self.preloadWorld];
  }
  [self completeLoad:NO reason:@"ELECTRON_MBT_WINDOW_DESTROYED"];
  self.web.navigationDelegate = nil;
  self.web.UIDelegate = nil;
  [self.web stopLoading];
  self.permittedClose = YES;
  self.native.delegate = nil;
  [self.native close];
}
@end

@interface MBTHost : NSObject
@property(nonatomic, copy) NSString *root;
@property(nonatomic, copy) NSString *session;
@property(nonatomic, strong) NSMutableDictionary<NSNumber *, MBTWindow *> *windows;
@property(nonatomic, strong) dispatch_queue_t notificationQueue;
@property(nonatomic) long long nextEvent;
- (void)publishContentGone:(NSNumber *)windowID generation:(long long)generation;
- (void)publishBootstrapAttested:(NSNumber *)windowID generation:(long long)generation;
- (long long)publishCloseRequested:(NSNumber *)windowID generation:(long long)generation;
- (long long)publishNativeEvent:(NSString *)operation windowID:(NSNumber *)windowID generation:(long long)generation;
- (void)handle:(NSDictionary *)request done:(void (^)(NSString *, NSDictionary *))done;
@end

@implementation MBTHost
- (instancetype)init {
  self = [super init];
  if (self) {
    self.windows = [NSMutableDictionary dictionary];
    self.notificationQueue = dispatch_queue_create("electron.mbt.content.events", DISPATCH_QUEUE_SERIAL);
    self.nextEvent = 0;
  }
  return self;
}
- (long long)publishNativeEvent:(NSString *)operation windowID:(NSNumber *)windowID
                generation:(long long)generation {
  if (self.nextEvent == 9007199254740991LL) _exit(2);
  NSNumber *eventID = @(++self.nextEvent);
  NSDictionary *notice = @{
    @"version": @1, @"session": self.session, @"request": eventID,
    @"window": windowID, @"generation": @(generation),
    @"operation": operation, @"payload": @{}
  };
  // Delegate callbacks run on AppKit's main thread. Never perform blocking
  // native-to-Node I/O here; the dedicated serial event queue preserves order.
  dispatch_async(self.notificationQueue, ^{
    if (!writeFrame(kEventChannel, notice)) _exit(2);
  });
  return eventID.longLongValue;
}
- (void)publishContentGone:(NSNumber *)windowID generation:(long long)generation {
  [self publishNativeEvent:@"web-content-gone" windowID:windowID generation:generation];
}
- (void)publishBootstrapAttested:(NSNumber *)windowID generation:(long long)generation {
  [self publishNativeEvent:@"isolated-preload-attested" windowID:windowID generation:generation];
}
- (long long)publishCloseRequested:(NSNumber *)windowID generation:(long long)generation {
  return [self publishNativeEvent:@"native-close-request" windowID:windowID generation:generation];
}
- (void)handle:(NSDictionary *)request done:(void (^)(NSString *, NSDictionary *))done {
  if (![NSThread isMainThread]) { done(@"failure", @{@"code": @"ELECTRON_MBT_THREAD"}); return; }
  NSString *operation = request[@"operation"];
  NSNumber *windowID = request[@"window"];
  NSNumber *generation = request[@"generation"];
  NSDictionary *payload = request[@"payload"];
  if (![operation isKindOfClass:[NSString class]] || ![windowID isKindOfClass:[NSNumber class]] ||
      ![generation isKindOfClass:[NSNumber class]] || ![payload isKindOfClass:[NSDictionary class]]) {
    done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
    return;
  }
  if ([operation isEqualToString:@"hello"] || [operation isEqualToString:@"ready"]) {
    done(@"success", @{@"backend": @"AppKit+WKWebView", @"pid": @(getpid()),
      @"webKit": [[NSBundle bundleForClass:[WKWebView class]] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown"});
    return;
  }
  if ([operation isEqualToString:@"shutdown"]) {
    for (MBTWindow *window in self.windows.allValues) [window tearDown];
    [self.windows removeAllObjects];
    done(@"success", @{@"closed": @YES});
    return;
  }
  if ([operation isEqualToString:@"create-window"]) {
    NSNumber *width = payload[@"width"];
    NSNumber *height = payload[@"height"];
    NSString *title = payload[@"title"];
    NSNumber *visible = payload[@"show"];
    NSString *preloadSource = payload[@"preloadSource"];
    NSString *preloadSHA256 = payload[@"preloadSHA256"];
    BOOL wantsPreload = preloadSource != nil || preloadSHA256 != nil;
    NSData *preloadBytes = [preloadSource isKindOfClass:[NSString class]] ?
      [preloadSource dataUsingEncoding:NSUTF8StringEncoding] : nil;
    BOOL validPreload = !wantsPreload || (
      payload.count == 6 && [preloadSource isKindOfClass:[NSString class]] &&
      [preloadSHA256 isKindOfClass:[NSString class]] && preloadBytes != nil &&
      preloadBytes.length > 0 && preloadBytes.length <= 65536 &&
      preloadSHA256.length == 64 &&
      [preloadDigest(preloadBytes) isEqualToString:preloadSHA256]);
    if (!validPreload || (wantsPreload ? payload.count != 6 : payload.count != 4) ||
        self.windows.count >= 64 || self.windows[windowID] ||
        generation.longLongValue != 0 || windowID.longLongValue <= 0 ||
        ![width isKindOfClass:[NSNumber class]] || ![height isKindOfClass:[NSNumber class]] ||
        width.integerValue < 100 || width.integerValue > 4096 ||
        height.integerValue < 100 || height.integerValue > 4096 ||
        ![title isKindOfClass:[NSString class]] || title.length > 256 ||
        ![visible isKindOfClass:[NSNumber class]]) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
      return;
    }
    MBTWindow *window = [[MBTWindow alloc] initWithRoot:self.root
      width:width.integerValue height:height.integerValue title:title
      visible:visible.boolValue preloadSource:wantsPreload ? preloadSource : nil];
    __weak MBTHost *weakHost = self;
    window.contentGone = ^(long long eventGeneration) {
      [weakHost publishContentGone:windowID generation:eventGeneration];
    };
    window.bootstrapAttested = ^(long long eventGeneration) {
      [weakHost publishBootstrapAttested:windowID generation:eventGeneration];
    };
    window.closeRequested = ^long long(long long eventGeneration) {
      return [weakHost publishCloseRequested:windowID generation:eventGeneration];
    };
    self.windows[windowID] = window;
#if defined(ELECTRON_MBT_TEST_NATIVE_CLOSE)
    // A standalone test build invokes the actual NSWindow close action twice.
    // The first should be cancellable by main, the second should close only
    // after native ACK. This is not a physical mouse/keyboard test.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
      MBTHost *host = weakHost;
      MBTWindow *candidate = host.windows[windowID];
      if (candidate) [candidate.native performClose:nil];
    });
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1300 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
      MBTHost *host = weakHost;
      MBTWindow *candidate = host.windows[windowID];
      if (candidate) [candidate.native performClose:nil];
    });
#endif
    done(@"success", @{@"webViewAttached": @YES,
      @"visible": visible, @"width": width, @"height": height});
    return;
  }
  MBTWindow *window = self.windows[windowID];
  if (!window) { done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_UNKNOWN"}); return; }
  if ([operation isEqualToString:@"install-adapted-adapter"]) {
    NSString *file = payload[@"file"];
    if (payload.count != 1 || ![file isKindOfClass:[NSString class]] ||
        window.generation != 0 || !window.contentAlive ||
        window.adaptedAdapterSource != nil) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
      return;
    }
    NSString *canonical = canonicalPath(file);
    NSString *readPath = nil;
    if (window.snapshotFiles != nil) {
      readPath = canonical ? window.snapshotFiles[canonical] : nil;
      if (readPath == nil) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_DENIED"});
        return;
      }
    } else {
      if (!canonical || ![window withinRoot:canonical]) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_FILE_OR_GENERATION_DENIED"});
        return;
      }
      readPath = canonical;
    }
    struct stat info;
    if (stat(readPath.fileSystemRepresentation, &info) != 0 || !S_ISREG(info.st_mode) ||
        info.st_size <= 0 || info.st_size > 65536) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
      return;
    }
    NSData *data = [NSData dataWithContentsOfFile:readPath];
    NSString *source = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
    if (source == nil || source.length == 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
      return;
    }
    window.adaptedAdapterSource = source;
    // The installation receipt has its own page-world handler. It accepts only
    // the per-document nonce and never routes application operations.
    [window.web.configuration.userContentController addScriptMessageHandlerWithReply:window
      contentWorld:[WKContentWorld pageWorld] name:@"electronMbtAdapterInstalled"];
    // The application handler is page-callable. It derives the sender from the
    // actual WKScriptMessage frame/document, never from request payload fields.
    [window.web.configuration.userContentController addScriptMessageHandlerWithReply:window
      contentWorld:[WKContentWorld pageWorld] name:@"electronMbtApp"];
    done(@"success", @{@"installed": @YES});
    return;
  }
  if ([operation isEqualToString:@"begin-load"]) {
    if (!window.contentAlive || generation.longLongValue <= window.generation ||
        generation.longLongValue <= 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_STALE_DOCUMENT"});
      return;
    }
    // A synchronous reservation only changes generation and invalidates the
    // previous document. WK navigation itself runs on the asynchronous lane.
    window.generation = generation.longLongValue;
    window.allowNextNavigation = NO;
    window.loadedFile = nil;
    window.bootstrapNonce = nil;
    window.bootstrapObservedGeneration = 0;
    window.preloadNonce = nil;
    window.preloadObservedGeneration = 0;
    window.preloadStatus = nil;
    window.preloadFinishedGeneration = 0;
    window.adaptedAdapterNonce = nil;
    window.adaptedEventNonce = nil;
    window.adaptedAdapterObservedGeneration = 0;
    window.adaptedAdapterBeforeLoad = NO;
    window.ingressAdmitted = 0;
    window.ingressDenied = 0;
    window.ingressLastCode = nil;
    [window.web.configuration.userContentController removeAllUserScripts];
    // Drop the old delegate token and settle its request before stopLoading
    // can deliver a late failure callback against a later generation.
    [window completeLoad:NO reason:@"ELECTRON_MBT_STALE_DOCUMENT"];
    [window.web stopLoading];
    done(@"success", @{@"generation": generation});
    return;
  }
  if ([operation isEqualToString:@"load-file"]) {
    NSString *file = payload[@"file"];
    NSString *canonical = canonicalPath(file);
    BOOL snapshot = window.snapshotFiles != nil;
    NSString *staged = canonical ? window.snapshotFiles[canonical] : nil;
    BOOL pathAllowed = canonical != nil &&
      (snapshot ? staged != nil : [window withinRoot:canonical]);
    if (![file isKindOfClass:[NSString class]] || !canonical || !pathAllowed ||
        generation.longLongValue != window.generation ||
        generation.longLongValue <= window.loadedGeneration ||
        window.loadDone != nil || !window.contentAlive) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_FILE_OR_GENERATION_DENIED"});
      return;
    }
    NSString *loadPath = snapshot ? staged : canonical;
    NSString *readRoot = snapshot ? window.snapshotRoot : self.root;
    struct stat info;
    if (stat(loadPath.fileSystemRepresentation, &info) != 0 || !S_ISREG(info.st_mode)) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_FILE_OR_GENERATION_DENIED"});
      return;
    }
    window.loadedGeneration = generation.longLongValue;
    window.loadedFile = loadPath;
    [window installBootstrapScript];
    window.allowNextNavigation = YES;
#if defined(ELECTRON_MBT_TEST_STALE_NAVIGATION_CALLBACK)
    __weak MBTWindow *weakWindow = window;
#endif
    window.loadDone = ^(BOOL ok, NSString *reason) {
      if (ok) {
#if defined(ELECTRON_MBT_TEST_STALE_NAVIGATION_CALLBACK)
        MBTWindow *candidate = weakWindow;
        done(@"success", @{@"didFinishLoad": @YES,
          @"url": [NSURL fileURLWithPath:loadPath].absoluteString,
          @"testRetiredNavigationCallbackCount": @(candidate ? candidate.testingStaleNavigationCallbackCount : 0)});
#else
        done(@"success", @{@"didFinishLoad": @YES,
          @"url": [NSURL fileURLWithPath:loadPath].absoluteString});
#endif
      } else done(@"failure", @{@"code": reason});
    };
    window.loadingNavigationGeneration = generation.longLongValue;
    window.loadingNavigation = [window.web loadFileURL:[NSURL fileURLWithPath:loadPath]
        allowingReadAccessToURL:[NSURL fileURLWithPath:readRoot isDirectory:YES]];
    if (!window.loadingNavigation) {
      window.allowNextNavigation = NO;
      [window completeLoad:NO reason:@"ELECTRON_MBT_LOAD_FAILED"];
      return;
    }
#if defined(ELECTRON_MBT_TEST_STALE_NAVIGATION_CALLBACK)
    if (generation.longLongValue > 1 && window.testingRetiredNavigation &&
        !window.testingStaleNavigationCallbackScheduled) {
      window.testingStaleNavigationCallbackScheduled = YES;
      WKNavigation *retiredNavigation = window.testingRetiredNavigation;
      NSError *retiredError = [NSError errorWithDomain:@"ELECTRON_MBT_TEST_STALE_NAVIGATION"
                                                   code:1 userInfo:nil];
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                     dispatch_get_main_queue(), ^{
        MBTWindow *candidate = weakWindow;
        if (candidate && candidate.contentAlive) {
          candidate.testingStaleNavigationCallbackCount++;
          [candidate webView:candidate.web didFinishNavigation:retiredNavigation];
          candidate.testingStaleNavigationCallbackCount++;
          [candidate webView:candidate.web didFailNavigation:retiredNavigation
                   withError:retiredError];
          candidate.testingStaleNavigationCallbackCount++;
          [candidate webView:candidate.web didFailProvisionalNavigation:retiredNavigation
                   withError:retiredError];
        }
      });
    }
#endif
    return;
  }
  if (generation.longLongValue != window.generation) {
    done(@"failure", @{@"code": @"ELECTRON_MBT_STALE_DOCUMENT"});
    return;
  }
  if ([operation isEqualToString:@"get-bootstrap-status"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    done(@"success", [window bootstrapStatus]);
    return;
  }
  if ([operation isEqualToString:@"cancel-close"]) {
    // A queued event cannot be withdrawn from the serial notification queue.
    // Returning its exact ID lets Node ignore only that already-cancelled
    // native attempt without discarding a newer physical close gesture.
    long long cancelledID = window.closeRequestOutstanding ?
      window.closeRequestEventID : 0;
    window.closeRequestOutstanding = NO;
    window.closeRequestEventID = 0;
    done(@"success", @{@"cancelled": @YES,
                       @"cancelledNativeRequest": @(cancelledID)});
    return;
  }
  if ([operation isEqualToString:@"show-window"]) {
    if (!window.contentAlive) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WEB_PROCESS_TERMINATED"});
      return;
    }
    [window.native orderFront:nil];
    done(@"success", @{@"visible": @([window.native isVisible])});
    return;
  }
  if ([operation isEqualToString:@"hide-window"]) {
    [window.native orderOut:nil];
    done(@"success", @{@"visible": @([window.native isVisible])});
    return;
  }
  if ([operation isEqualToString:@"is-window-visible"]) {
    done(@"success", @{@"visible": @([window.native isVisible])});
    return;
  }
  if ([operation isEqualToString:@"get-web-contents-url"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    if (!window.contentAlive) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WEB_PROCESS_TERMINATED"});
      return;
    }
    NSString *url = window.web.URL.absoluteString ?: @"";
    if (url.length > 8192) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    done(@"success", @{@"url": url});
    return;
  }
  if ([operation isEqualToString:@"get-web-contents-title"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    if (!window.contentAlive) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WEB_PROCESS_TERMINATED"});
      return;
    }
    NSString *title = window.web.title ?: @"";
    if (title.length > 4096) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    done(@"success", @{@"title": title});
    return;
  }
  if ([operation isEqualToString:@"get-window-bounds"] ||
      [operation isEqualToString:@"set-window-bounds"]) {
    BOOL changing = [operation isEqualToString:@"set-window-bounds"];
    if ((!changing && payload.count != 0) || (changing && payload.count > 4)) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    // NSScreen.mainScreen depends on focus; the primary display is a stable
    // anchor for both native reads and partial updates of hidden windows.
    NSScreen *primary = [NSScreen screens].firstObject;
    NSDictionary *current = readWindowBounds(window.native, primary);
    if (!current) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    if (changing) {
      for (NSString *key in payload) {
        BOOL position = [key isEqualToString:@"x"] || [key isEqualToString:@"y"];
        BOOL dimension = [key isEqualToString:@"width"] || [key isEqualToString:@"height"];
        id value = payload[key];
        if ((!position && !dimension) || ![value isKindOfClass:[NSNumber class]] ||
            CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) {
          done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
          return;
        }
        double number = [value doubleValue];
        if (!isfinite(number) || floor(number) != number ||
            (position && fabs(number) > 1048576.0) ||
            (dimension && (number < 100.0 || number > 4096.0))) {
          done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
          return;
        }
      }
      double x = payload[@"x"] ? [payload[@"x"] doubleValue] : [current[@"x"] doubleValue];
      double y = payload[@"y"] ? [payload[@"y"] doubleValue] : [current[@"y"] doubleValue];
      double width = payload[@"width"] ? [payload[@"width"] doubleValue] : [current[@"width"] doubleValue];
      double height = payload[@"height"] ? [payload[@"height"] doubleValue] : [current[@"height"] doubleValue];
      NSRect screen = primary.frame;
      NSRect next = NSMakeRect(NSMinX(screen) + x, NSMaxY(screen) - y - height, width, height);
      [window.native setFrame:next display:NO];
    }
    NSDictionary *observed = readWindowBounds(window.native, primary);
    if (!observed) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    done(@"success", observed);
    return;
  }
  if ([operation isEqualToString:@"get-preload-status"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    NSString *status = window.preloadStatus ?: window.preloadLastStatus ?: @"absent";
    NSString *detail = window.preloadDetail ?: window.preloadLastDetail ?: @"";
    done(@"success", @{@"status": status, @"detail": detail});
    return;
  }
  if ([operation isEqualToString:@"get-adapted-status"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    BOOL observed = window.contentAlive && window.generation > 0 &&
      window.adaptedAdapterObservedGeneration == window.generation &&
      window.adaptedAdapterNonce != nil && window.adaptedAdapterBeforeLoad;
    done(@"success", @{@"observed": @(observed),
      @"generation": @(window.generation),
      @"documentStartBeforeLoad": @(window.adaptedAdapterBeforeLoad),
      @"ingress": @"absent"});
    return;
  }
  if ([operation isEqualToString:@"prepare-source"]) {
    if (payload.count != 1) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    NSString *file = payload[@"file"];
    if (!safeRelativePath(file)) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    if (!window.contentAlive || window.loadDone != nil || window.loadingNavigation != nil) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_STALE_DOCUMENT"});
      return;
    }
    NSData *manifestData = nil;
    NSDictionary *manifest = readSourceManifest(self.root, &manifestData);
    if (!manifest || manifest.count != 4 || manifestData == nil) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MANIFEST"});
      return;
    }
    NSNumber *schema = manifest[@"schema"];
    NSString *app = manifest[@"app"];
    NSString *entry = manifest[@"entry"];
    NSArray *files = manifest[@"files"];
    if (![schema isKindOfClass:[NSNumber class]] || schema.integerValue != 2 ||
        schema.doubleValue != 2.0 ||
        CFGetTypeID((__bridge CFTypeRef)schema) == CFBooleanGetTypeID() ||
        ![app isKindOfClass:[NSString class]] || app.length == 0 || app.length > 128 ||
        !safeRelativePath(entry) || ![entry isEqualToString:file] ||
        ![files isKindOfClass:[NSArray class]] || files.count == 0 || files.count > 32) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MANIFEST"});
      return;
    }
    NSMutableDictionary<NSString *, NSData *> *sourceData = [NSMutableDictionary dictionary];
    NSMutableSet<NSString *> *seen = [NSMutableSet set];
    BOOL entrySeen = NO;
    for (id item in files) {
      if (![item isKindOfClass:[NSDictionary class]] || ((NSDictionary *)item).count != 3) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MANIFEST"});
        return;
      }
      NSDictionary *fileEntry = item;
      NSString *path = fileEntry[@"path"];
      NSString *expectedHash = fileEntry[@"sha256"];
      NSNumber *expectedBytes = fileEntry[@"bytes"];
      if (!safeRelativePath(path) || !validSHA256(expectedHash) ||
          ![expectedBytes isKindOfClass:[NSNumber class]] ||
          CFGetTypeID((__bridge CFTypeRef)expectedBytes) == CFBooleanGetTypeID() ||
          expectedBytes.doubleValue != (double)expectedBytes.longLongValue ||
          expectedBytes.longLongValue <= 0 ||
          expectedBytes.longLongValue > (long long)MaxSnapshotBytes ||
          [seen containsObject:path]) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MANIFEST"});
        return;
      }
      [seen addObject:path];
      if ([path isEqualToString:entry]) entrySeen = YES;
      NSString *source = canonicalPath([self.root stringByAppendingPathComponent:path]);
      if (!source || ![window withinRoot:source]) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_DENIED"});
        return;
      }
      struct stat info;
      if (stat(source.fileSystemRepresentation, &info) != 0 || !S_ISREG(info.st_mode) ||
          info.st_size <= 0 || info.st_size > (off_t)MaxSnapshotBytes) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_DENIED"});
        return;
      }
      NSData *data = [NSData dataWithContentsOfFile:source options:0 error:nil];
      if (!data || data.length == 0 || data.length > MaxSnapshotBytes ||
          data.length != expectedBytes.unsignedLongLongValue) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MISMATCH"});
        return;
      }
      NSString *actualHash = preloadDigest(data);
      if (![actualHash isEqualToString:expectedHash]) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MISMATCH"});
        return;
      }
      sourceData[source] = data;
    }
    if (!entrySeen) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MANIFEST"});
      return;
    }
    NSString *snapshotRoot = [NSTemporaryDirectory() stringByAppendingPathComponent:
      [NSString stringWithFormat:@"electron-mbt-snapshot-%@", [[NSUUID UUID] UUIDString]]];
    NSError *error = nil;
    NSDictionary *directoryAttributes = @{NSFilePosixPermissions: @0700};
    if (![[NSFileManager defaultManager] createDirectoryAtPath:snapshotRoot
          withIntermediateDirectories:NO attributes:directoryAttributes error:&error]) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    // Resolve the /var -> /private/var alias before handing the read root to
    // WebKit, or the file URL and its sandbox grant can disagree.
    NSString *canonicalSnapshotRoot = canonicalPath(snapshotRoot);
    if (!canonicalSnapshotRoot) {
      [[NSFileManager defaultManager] removeItemAtPath:snapshotRoot error:nil];
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    NSMutableDictionary<NSString *, NSString *> *stagedBySource = [NSMutableDictionary dictionary];
    BOOL writeOK = YES;
    for (NSString *source in sourceData) {
      NSString *relative = [source substringFromIndex:self.root.length + 1];
      NSString *staged = [canonicalSnapshotRoot stringByAppendingPathComponent:relative];
      NSString *parent = [staged stringByDeletingLastPathComponent];
      if (![[NSFileManager defaultManager] createDirectoryAtPath:parent
            withIntermediateDirectories:YES attributes:directoryAttributes error:&error] ||
          ![sourceData[source] writeToFile:staged options:NSDataWritingAtomic error:&error]) {
        writeOK = NO;
        break;
      }
      [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions: @0600}
        ofItemAtPath:staged error:nil];
      stagedBySource[source] = staged;
    }
    if (!writeOK) {
      [[NSFileManager defaultManager] removeItemAtPath:canonicalSnapshotRoot error:nil];
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    NSString *entrySource = canonicalPath([self.root stringByAppendingPathComponent:entry]);
    NSString *entryStaged = entrySource ? stagedBySource[entrySource] : nil;
    NSData *entryData = entrySource ? sourceData[entrySource] : nil;
    if (!entrySource || !entryStaged || !entryData) {
      [[NSFileManager defaultManager] removeItemAtPath:canonicalSnapshotRoot error:nil];
      done(@"failure", @{@"code": @"ELECTRON_MBT_SOURCE_MANIFEST"});
      return;
    }
    [window clearSnapshot];
    window.snapshotSourceFile = entrySource;
    window.snapshotRoot = canonicalSnapshotRoot;
    window.snapshotFile = entryStaged;
    window.snapshotSHA256 = preloadDigest(entryData);
    window.snapshotBytes = (long long)entryData.length;
    window.snapshotFiles = [stagedBySource copy];
    window.snapshotManifestSHA256 = preloadDigest(manifestData);
    done(@"success", @{@"prepared": @YES, @"sha256": window.snapshotSHA256,
      @"bytes": @(entryData.length), @"files": @(files.count),
      @"manifestSHA256": window.snapshotManifestSHA256});
    return;
  }
  if ([operation isEqualToString:@"get-document-identity"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    NSURL *url = window.web.URL;
    NSString *current = url.isFileURL ? canonicalPath(url.path) : nil;
    BOOL observed = window.contentAlive && window.generation > 0 &&
      window.loadedGeneration == window.generation && window.loadedFile != nil &&
      window.loadDone == nil && window.loadingNavigation == nil &&
      current != nil && [current isEqualToString:window.loadedFile];
    if (!observed) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_STALE_DOCUMENT"});
      return;
    }
    BOOL snapshot = window.snapshotFile != nil &&
      [window.loadedFile isEqualToString:window.snapshotFile];
    done(@"success", @{@"generation": @(window.generation),
      @"source": snapshot ? @"snapshot" : @"app",
      @"sha256": snapshot ? (window.snapshotSHA256 ?: @"") : @"",
      @"manifestSHA256": snapshot ? (window.snapshotManifestSHA256 ?: @"") : @""});
    return;
  }
  if ([operation isEqualToString:@"get-ingress-status"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    done(@"success", @{@"admitted": @(window.ingressAdmitted),
      @"denied": @(window.ingressDenied),
      @"lastCode": window.ingressLastCode ?: @"",
      @"generation": @(window.generation)});
    return;
  }
  if ([operation isEqualToString:@"trigger-adapted-ingress"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    if (!window.contentAlive || window.generation <= 0 || window.loadedFile == nil ||
        window.adaptedAdapterObservedGeneration != window.generation) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_STALE_DOCUMENT"});
      return;
    }
    NSString *script = @"if (typeof window.__electronMbtIngressProbe === 'function') { "
      "window.__electronMbtIngressProbe(); } else { "
      "throw new Error('ELECTRON_MBT_INGRESS_PROBE_MISSING'); } true;";
    long long eventGeneration = generation.longLongValue;
    __weak MBTWindow *weakWindow = window;
    [window.web evaluateJavaScript:script inFrame:nil
      inContentWorld:[WKContentWorld pageWorld]
      completionHandler:^(id _Nullable result, NSError * _Nullable error) {
        (void)result;
        MBTWindow *candidate = weakWindow;
        if (error != nil || candidate == nil || !candidate.contentAlive ||
            candidate.generation != eventGeneration) {
          done(@"failure", @{@"code": @"ELECTRON_MBT_INGRESS_PROBE_FAILED"});
          return;
        }
        done(@"success", @{@"triggered": @YES});
      }];
    return;
  }
  if ([operation isEqualToString:@"dispatch-adapted-event"]) {
    if (payload.count != 2) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    NSString *topic = payload[@"topic"];
    NSString *value = payload[@"value"];
    if (![topic isKindOfClass:[NSString class]] ||
        ![@[@"doc:open", @"app:request-close", @"update:state"] containsObject:topic] ||
        ![value isKindOfClass:[NSString class]] || value.length == 0 || value.length > 256) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    if (!window.contentAlive || window.generation <= 0 ||
        window.adaptedEventNonce == nil ||
        window.adaptedAdapterObservedGeneration != window.generation ||
        window.loadDone != nil || window.loadingNavigation != nil) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_STALE_DOCUMENT"});
      return;
    }
    NSError *jsonError = nil;
    NSData *payloadData = [NSJSONSerialization dataWithJSONObject:
      @{@"source": @"native", @"value": value} options:0 error:&jsonError];
    NSString *payloadText = payloadData ?
      [[NSString alloc] initWithData:payloadData encoding:NSUTF8StringEncoding] : nil;
    NSString *nonce = jsQuotedString(window.adaptedEventNonce);
    NSString *quotedTopic = jsQuotedString(topic);
    NSString *quotedPayload = jsQuotedString(payloadText);
    if (jsonError != nil || payloadText == nil || nonce == nil ||
        quotedTopic == nil || quotedPayload == nil) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    // This is a private-lane fixture trigger, not an application event route.
    // The page dispatcher also checks the nonce; a stale or destroyed document
    // cannot receive the event even if the completion block runs late.
    NSString *script = [NSString stringWithFormat:
      @"window.__electronMbtDispatch(%@, %@, JSON.parse(%@));",
      nonce, quotedTopic, quotedPayload];
    long long eventGeneration = generation.longLongValue;
    __weak MBTWindow *weakWindow = window;
    [window.web evaluateJavaScript:script inFrame:nil
      inContentWorld:[WKContentWorld pageWorld]
      completionHandler:^(id _Nullable result, NSError * _Nullable error) {
        (void)result;
        MBTWindow *candidate = weakWindow;
        if (error != nil || candidate == nil || !candidate.contentAlive ||
            candidate.generation != eventGeneration ||
            candidate.adaptedEventNonce == nil) {
          done(@"failure", @{@"code": @"ELECTRON_MBT_ADAPTED_EVENT_FAILED"});
          return;
        }
        done(@"success", @{@"delivered": @YES, @"topic": topic,
          @"generation": @(eventGeneration)});
      }];
    return;
  }
  if ([operation isEqualToString:@"get-window-min-size"] ||
      [operation isEqualToString:@"set-window-min-size"]) {
    BOOL changing = [operation isEqualToString:@"set-window-min-size"];
    if ((!changing && payload.count != 0) || (changing && payload.count != 2)) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    if (changing) {
      NSNumber *width = payload[@"width"];
      NSNumber *height = payload[@"height"];
      if (![width isKindOfClass:[NSNumber class]] || ![height isKindOfClass:[NSNumber class]] ||
          CFGetTypeID((__bridge CFTypeRef)width) == CFBooleanGetTypeID() ||
          CFGetTypeID((__bridge CFTypeRef)height) == CFBooleanGetTypeID()) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
        return;
      }
      double w = width.doubleValue;
      double h = height.doubleValue;
      if (!isfinite(w) || !isfinite(h) || floor(w) != w || floor(h) != h ||
          w < 0.0 || h < 0.0 || w > 4096.0 || h > 4096.0) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
        return;
      }
      window.native.contentMinSize = NSMakeSize(w, h);
    }
    NSSize observed = window.native.contentMinSize;
    done(@"success", @{@"width": @(llround(observed.width)), @"height": @(llround(observed.height))});
    return;
  }
  if ([operation isEqualToString:@"get-window-background-color"] ||
      [operation isEqualToString:@"set-window-background-color"]) {
    BOOL changing = [operation isEqualToString:@"set-window-background-color"];
    if ((!changing && payload.count != 0) || (changing && payload.count != 1)) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    if (changing) {
      NSColor *color = windowBackgroundColor(payload[@"color"]);
      if (!color) {
        done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
        return;
      }
      window.native.backgroundColor = color;
    }
    NSString *hex = windowBackgroundHex(window.native.backgroundColor);
    if (!hex) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_NATIVE_FAILURE"});
      return;
    }
    done(@"success", @{@"color": hex});
    return;
  }
  if ([operation isEqualToString:@"get-window-title"]) {
    if (payload.count != 0) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_INVALID_ENVELOPE"});
      return;
    }
    done(@"success", @{@"title": window.native.title ?: @""});
    return;
  }
  if ([operation isEqualToString:@"set-window-title"]) {
    NSString *title = payload[@"title"];
    if (payload.count != 1 || ![title isKindOfClass:[NSString class]] || title.length > 256) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_OPTIONS"});
      return;
    }
    window.native.title = title;
    done(@"success", @{@"title": window.native.title ?: @""});
    return;
  }
  if ([operation isEqualToString:@"close-window"] || [operation isEqualToString:@"destroy-window"]) {
    [window tearDown];
    [self.windows removeObjectForKey:windowID];
    done(@"success", @{@"destroyed": @YES});
    return;
  }
  done(@"failure", @{@"code": @"ELECTRON_MBT_UNSUPPORTED_API"});
}
@end

static BOOL canonicalControlFrame(NSData *frame) {
  // This native leaf only accepts the canonical header generated by the
  // checked Node encoder. A rounded NSNumber is not evidence that the raw
  // request/window/generation/version lexeme was a safe integer.
  NSString *source = [[NSString alloc] initWithData:frame encoding:NSUTF8StringEncoding];
  if (!source) return NO;
  static NSRegularExpression *header;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *pattern =
      @"^\\{\"version\":1,\"session\":\"[0-9a-f]{32}\","
       "\"request\":(?:0|[1-9][0-9]{0,15}),"
       "\"window\":(?:0|[1-9][0-9]{0,15}),"
       "\"generation\":(?:0|[1-9][0-9]{0,15}),"
       "\"operation\":\"[a-z-]+\",\"payload\":\\{";
    header = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:NULL];
  });
  NSTextCheckingResult *match = [header firstMatchInString:source
      options:0 range:NSMakeRange(0, source.length)];
  if (!match || match.range.location != 0) return NO;
  NSUInteger cursor = NSMaxRange(match.range);
  // The canonical payload must be the final top-level member. Trailing
  // duplicate identity keys must never overwrite the validated header.
  const unsigned char *bytes = frame.bytes;
  NSUInteger size = frame.length;
  NSInteger depth = 1;
  BOOL inString = NO, escaped = NO;
  for (; cursor < size; cursor++) {
    unsigned char character = bytes[cursor];
    if (inString) {
      if (escaped) escaped = NO;
      else if (character == '\\') escaped = YES;
      else if (character == '"') inString = NO;
      continue;
    }
    if (character == '"') { inString = YES; continue; }
    if (character == '{' || character == '[') depth++;
    else if (character == '}' || character == ']') {
      if (--depth == 0) {
        return cursor + 2 == size && bytes[cursor + 1] == '}';
      }
    }
  }
  return NO;
}

static BOOL safeUnsignedNumber(id value, BOOL positive) {
  if (![value isKindOfClass:[NSNumber class]] ||
      CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) return NO;
  double number = [value doubleValue];
  if (!isfinite(number) || floor(number) != number ||
      number > 9007199254740991.0 || number < (positive ? 1.0 : 0.0)) return NO;
  return YES;
}

static BOOL checkRequest(NSDictionary *request, NSString *session) {
  if (![request isKindOfClass:[NSDictionary class]] || request.count != 7 ||
      ![request[@"session"] isEqual:session] || ![request[@"version"] isEqual:@1] ||
      ![request[@"request"] isKindOfClass:[NSNumber class]] ||
      ![request[@"operation"] isKindOfClass:[NSString class]] ||
      ![request[@"payload"] isKindOfClass:[NSDictionary class]] ||
      ![request[@"window"] isKindOfClass:[NSNumber class]] ||
      ![request[@"generation"] isKindOfClass:[NSNumber class]]) return NO;
  return safeUnsignedNumber(request[@"version"], YES) &&
         safeUnsignedNumber(request[@"request"], YES) &&
         safeUnsignedNumber(request[@"window"], NO) &&
         safeUnsignedNumber(request[@"generation"], NO);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2 || fcntl(kControlChannel, F_GETFD) < 0 ||
        fcntl(kLoadChannel, F_GETFD) < 0 ||
        fcntl(kEventChannel, F_GETFD) < 0) return 64;
    const char *secret = getenv("ELECTRON_MBT_HOST_SESSION");
    if (!secret || strlen(secret) != 32) return 64;
    NSString *root = canonicalPath([NSString stringWithUTF8String:argv[1]]);
    NSString *session = [NSString stringWithUTF8String:secret];
    if (!root || !session) return 64;
    struct stat info;
    if (stat(root.fileSystemRepresentation, &info) != 0 || !S_ISDIR(info.st_mode)) return 64;
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    MBTHost *host = [[MBTHost alloc] init];
    host.root = root;
    host.session = session;
    for (int fd = kControlChannel; fd <= kLoadChannel; fd++) {
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
          for (;;) {
            NSData *frame = readFrame(fd);
          if (!frame) break;
          NSError *error = nil;
          NSDictionary *request = [NSJSONSerialization JSONObjectWithData:frame
              options:0 error:&error];
          // Only the inherited private descriptor is accepted; malformed or
          // session-mismatched frames terminate it without a dispatch attempt.
          if (error || !canonicalControlFrame(frame) ||
              !checkRequest(request, session)) break;
          BOOL isLoad = [request[@"operation"] isEqualToString:@"load-file"];
          if ((fd == kLoadChannel) != isLoad) break;
          dispatch_semaphore_t finished = dispatch_semaphore_create(0);
          __block NSDictionary *reply = nil;
          dispatch_async(dispatch_get_main_queue(), ^{
            [host handle:request done:^(NSString *terminal, NSDictionary *payload) {
              NSMutableDictionary *result = [request mutableCopy];
              result[@"terminal"] = terminal;
              result[@"payload"] = payload;
              reply = result;
              dispatch_semaphore_signal(finished);
            }];
          });
          if (dispatch_semaphore_wait(finished,
              dispatch_time(DISPATCH_TIME_NOW, (int64_t)15 * NSEC_PER_SEC)) != 0 || !reply) break;
          if (!writeFrame(fd, reply)) break;
          if ([request[@"operation"] isEqual:@"shutdown"]) break;
        }
          // Closing either inherited peer channel aborts the entire session;
          // a partial session must not keep a detached privileged host alive.
          close(fd);
          _exit(0);
        }
      });
    }
    [NSApp run];
  }
  return 1;
}
