#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
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

static const uint32_t kMaxFrame = 1048576;
static const int kControlChannel = 3;
static const int kLoadChannel = 4;

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

static NSString *canonicalPath(NSString *path) {
  if (![path isKindOfClass:[NSString class]] || ![path isAbsolutePath]) return nil;
  char resolved[PATH_MAX];
  if (!realpath(path.fileSystemRepresentation, resolved)) return nil;
  return [NSString stringWithUTF8String:resolved];
}

@interface MBTWindow : NSObject <WKNavigationDelegate, NSWindowDelegate, WKUIDelegate>
@property(nonatomic, strong) NSWindow *native;
@property(nonatomic, strong) WKWebView *web;
@property(nonatomic, copy) NSString *root;
@property(nonatomic, copy) NSString *loadedFile;
@property(nonatomic, copy) void (^loadDone)(BOOL, NSString *);
@property(nonatomic) long long generation;
@property(nonatomic) BOOL permittedClose;
- (instancetype)initWithRoot:(NSString *)root width:(NSInteger)width height:(NSInteger)height
                       title:(NSString *)title visible:(BOOL)visible;
- (void)tearDown;
@end

@implementation MBTWindow
- (instancetype)initWithRoot:(NSString *)root width:(NSInteger)width height:(NSInteger)height
                       title:(NSString *)title visible:(BOOL)visible {
  self = [super init];
  if (self) {
    self.root = root;
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
    self.web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, width, height)
                                  configuration:config];
    self.web.navigationDelegate = self;
    self.web.UIDelegate = self;
    // The close button is intentionally absent until native-to-main close
    // cancellation can be proven, rather than silently ignoring Electron's close event.
    self.native = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, width, height)
      styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskResizable)
      backing:NSBackingStoreBuffered defer:NO];
    self.native.releasedWhenClosed = NO;
    self.native.delegate = self;
    self.native.contentView = self.web;
    self.native.title = title;
    self.generation = 0;
    if (visible) [self.native orderFront:nil];
  }
  return self;
}
- (BOOL)withinRoot:(NSString *)path {
  NSString *canonical = canonicalPath(path);
  if (!canonical) return NO;
  return [canonical hasPrefix:[self.root stringByAppendingString:@"/"]];
}
- (BOOL)windowShouldClose:(NSWindow *)sender {
  (void)sender;
  return self.permittedClose;
}
- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  NSURL *url = action.request.URL;
  NSString *canonical = url.isFileURL ? canonicalPath(url.path) : nil;
  BOOL allowed = action.targetFrame.isMainFrame && self.loadedFile != nil &&
                 [canonical isEqualToString:self.loadedFile];
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
  if (done) done(ok, reason);
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)webView; (void)navigation;
  [self completeLoad:YES reason:@""];
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation
      withError:(NSError *)error {
  (void)webView; (void)navigation; (void)error;
  [self completeLoad:NO reason:@"ELECTRON_MBT_LOAD_FAILED"];
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation
      withError:(NSError *)error {
  (void)webView; (void)navigation; (void)error;
  [self completeLoad:NO reason:@"ELECTRON_MBT_LOAD_FAILED"];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  (void)webView;
  [self completeLoad:NO reason:@"ELECTRON_MBT_WEB_PROCESS_TERMINATED"];
}
- (void)tearDown {
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
- (void)handle:(NSDictionary *)request done:(void (^)(NSString *, NSDictionary *))done;
@end

@implementation MBTHost
- (instancetype)init {
  self = [super init];
  if (self) self.windows = [NSMutableDictionary dictionary];
  return self;
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
    if (self.windows.count >= 64 || self.windows[windowID] ||
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
      visible:visible.boolValue];
    self.windows[windowID] = window;
    done(@"success", @{@"webViewAttached": @YES,
      @"visible": visible, @"width": width, @"height": height});
    return;
  }
  MBTWindow *window = self.windows[windowID];
  if (!window) { done(@"failure", @{@"code": @"ELECTRON_MBT_WINDOW_UNKNOWN"}); return; }
  if ([operation isEqualToString:@"load-file"]) {
    NSString *file = payload[@"file"];
    NSString *canonical = canonicalPath(file);
    if (![file isKindOfClass:[NSString class]] || !canonical || ![window withinRoot:canonical] ||
        generation.longLongValue <= window.generation || window.loadDone != nil) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_FILE_OR_GENERATION_DENIED"});
      return;
    }
    struct stat info;
    if (stat(canonical.fileSystemRepresentation, &info) != 0 || !S_ISREG(info.st_mode)) {
      done(@"failure", @{@"code": @"ELECTRON_MBT_FILE_OR_GENERATION_DENIED"});
      return;
    }
    window.generation = generation.longLongValue;
    window.loadedFile = canonical;
    window.loadDone = ^(BOOL ok, NSString *reason) {
      if (ok) done(@"success", @{@"didFinishLoad": @YES,
        @"url": [NSURL fileURLWithPath:canonical].absoluteString});
      else done(@"failure", @{@"code": reason});
    };
    [window.web loadFileURL:[NSURL fileURLWithPath:canonical]
        allowingReadAccessToURL:[NSURL fileURLWithPath:self.root isDirectory:YES]];
    return;
  }
  if (generation.longLongValue != window.generation) {
    done(@"failure", @{@"code": @"ELECTRON_MBT_STALE_DOCUMENT"});
    return;
  }
  if ([operation isEqualToString:@"show-window"]) {
    [window.native orderFront:nil];
    done(@"success", @{@"visible": @YES});
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

static BOOL checkRequest(NSDictionary *request, NSString *session) {
  if (![request isKindOfClass:[NSDictionary class]] || request.count != 7 ||
      ![request[@"session"] isEqual:session] || ![request[@"version"] isEqual:@1] ||
      ![request[@"request"] isKindOfClass:[NSNumber class]] ||
      ![request[@"operation"] isKindOfClass:[NSString class]] ||
      ![request[@"payload"] isKindOfClass:[NSDictionary class]] ||
      ![request[@"window"] isKindOfClass:[NSNumber class]] ||
      ![request[@"generation"] isKindOfClass:[NSNumber class]]) return NO;
  return [request[@"request"] longLongValue] > 0 &&
         [request[@"window"] longLongValue] >= 0 &&
         [request[@"generation"] longLongValue] >= 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2 || fcntl(kControlChannel, F_GETFD) < 0 ||
        fcntl(kLoadChannel, F_GETFD) < 0) return 64;
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
          if (error || !checkRequest(request, session)) break;
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
