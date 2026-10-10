#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static void finish(NSDictionary *result, int code) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
  if (json != nil) {
    fwrite(json.bytes, 1, json.length, stdout);
    fputc('\n', stdout);
    fflush(stdout);
  }
  exit(code);
}

static NSDictionary *decodeObject(id value) {
  if (![value isKindOfClass:[NSString class]]) return nil;
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
  return [parsed isKindOfClass:[NSDictionary class]] ? parsed : nil;
}

@interface M0BridgeProbe : NSObject <WKNavigationDelegate, WKScriptMessageHandlerWithReply>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKContentWorld *isolatedWorld;
@property(nonatomic, strong) NSURL *pageURL;
@property(nonatomic, copy) NSString *preloadSource;
@property(nonatomic, strong) NSDictionary *initialPage;
@property(nonatomic, strong) NSDictionary *initialIsolated;
@property(nonatomic) NSUInteger navigations;
@property(nonatomic) NSUInteger nativeReplyCount;
@property(nonatomic) NSUInteger documentStartNativeMessageCount;
@property(nonatomic) NSUInteger pageInducedNativeMessageCount;
@property(nonatomic) BOOL rejectedUnexpectedSender;
- (void)start;
@end

@implementation M0BridgeProbe
- (void)fail:(NSString *)code {
  finish(@{@"probe": @"m0-isolated-sync-feasibility", @"status": @"FAIL",
           @"code": code, @"compatible": @NO, @"compatibilityGate": @"OPEN"}, 1);
}
- (void)start {
  self.isolatedWorld = [WKContentWorld worldWithName:@"electron.mbt.m0.test-only"];
  WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
  config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  WKUserContentController *controller = config.userContentController;
  [controller addScriptMessageHandlerWithReply:self contentWorld:self.isolatedWorld
                                          name:@"electronMbtM0NativeReply"];
  WKUserScript *script = [[WKUserScript alloc] initWithSource:self.preloadSource
    injectionTime:WKUserScriptInjectionTimeAtDocumentStart
    forMainFrameOnly:YES inContentWorld:self.isolatedWorld];
  [controller addUserScript:script];
  self.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 640, 480)
                                    configuration:config];
  self.webView.navigationDelegate = self;
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 640, 480)
    styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  self.window.releasedWhenClosed = NO;
  self.window.contentView = self.webView;
  self.window.title = @"M0 isolated synchronous boundary diagnostic";
  [self.window orderFront:nil];
  [self.webView loadFileURL:self.pageURL
     allowingReadAccessToURL:self.pageURL.URLByDeletingLastPathComponent];
  __weak M0BridgeProbe *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC),
                 dispatch_get_main_queue(), ^{
    M0BridgeProbe *probe = weakSelf;
    if (probe) [probe fail:@"ELECTRON_MBT_M0_PROBE_TIMEOUT"];
  });
}

- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id _Nullable, NSString * _Nullable))replyHandler {
  (void)controller;
  NSString *claimedSource = [message.body isKindOfClass:[NSDictionary class]] ?
    message.body[@"source"] : nil;
  BOOL knownSource = [claimedSource isKindOfClass:[NSString class]] &&
    ([claimedSource isEqualToString:@"document-start"] ||
     [claimedSource isEqualToString:@"dom-triggered"]);
  BOOL valid = message.webView == self.webView && message.frameInfo.isMainFrame &&
    [message.name isEqualToString:@"electronMbtM0NativeReply"] &&
    [message.body isKindOfClass:[NSDictionary class]] &&
    [message.body[@"probe"] isEqual:@"m0"] && knownSource;
  if (!valid) {
    self.rejectedUnexpectedSender = YES;
    replyHandler(nil, @"ELECTRON_MBT_UNEXPECTED_M0_SENDER");
    return;
  }
  self.nativeReplyCount += 1;
  // Why not: claimedSource labels a diagnostic route, not the initiating realm.
  if ([claimedSource isEqualToString:@"dom-triggered"])
    self.pageInducedNativeMessageCount += 1;
  else
    self.documentStartNativeMessageCount += 1;
  replyHandler(@"native-ack", nil);
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  // Why not: a page redirect or subframe cannot become a privileged test sender.
  BOOL allowed = action.targetFrame.isMainFrame &&
    [action.request.URL isEqual:self.pageURL];
  decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
  if (!allowed) [self fail:@"ELECTRON_MBT_M0_NAVIGATION_DENIED"];
}

- (void)completeStage:(NSUInteger)stage page:(NSDictionary *)page isolated:(NSDictionary *)isolated {
  if (stage == 1) {
    self.initialPage = page;
    self.initialIsolated = isolated;
    [self.webView reload];
    return;
  }
  if (stage != 2 || !self.initialPage || !self.initialIsolated) {
    [self fail:@"ELECTRON_MBT_M0_UNEXPECTED_DOCUMENT_STATE"];
    return;
  }
  NSDictionary *firstPage = self.initialPage;
  NSDictionary *firstIsolated = self.initialIsolated;
  BOOL isolatedHidden = [firstPage[@"privateGlobalHidden"] isEqual:@YES] &&
    [firstPage[@"nativeReplyHandlerHidden"] isEqual:@YES] &&
    [page[@"privateGlobalHidden"] isEqual:@YES] &&
    [page[@"nativeReplyHandlerHidden"] isEqual:@YES] &&
    [firstIsolated[@"isolatedMarker"] isEqual:@YES] &&
    [isolated[@"isolatedMarker"] isEqual:@YES] &&
    [firstIsolated[@"primordialIntact"] isEqual:@YES] &&
    [isolated[@"primordialIntact"] isEqual:@YES];
  if (!isolatedHidden || ![firstPage[@"firstScriptAttempted"] isEqual:@YES] ||
      ![page[@"firstScriptAttempted"] isEqual:@YES] || self.rejectedUnexpectedSender) {
    [self fail:@"ELECTRON_MBT_M0_ISOLATION_OBSERVATION_FAILED"];
    return;
  }
  BOOL syncCandidate = [firstPage[@"synchronousValue"] isEqual:@YES] &&
    [firstPage[@"synchronousThrow"] isEqual:@YES] &&
    [firstIsolated[@"requests"] integerValue] >= 2;
  BOOL replayReset = [firstIsolated[@"requests"] integerValue] ==
                       [isolated[@"requests"] integerValue] &&
                     [firstIsolated[@"requests"] integerValue] > 0;
  BOOL pageInducedNative = [firstPage[@"pageTriggeredNativeMessage"] isEqual:@YES] &&
    [page[@"pageTriggeredNativeMessage"] isEqual:@YES] &&
    [firstIsolated[@"nativePageRequestCount"] integerValue] == 1 &&
    [isolated[@"nativePageRequestCount"] integerValue] == 1 &&
    [firstIsolated[@"nativePageReplySettled"] isEqual:@YES] &&
    [isolated[@"nativePageReplySettled"] isEqual:@YES] &&
    self.pageInducedNativeMessageCount == 2;
  // Why not: a forged DOM response and ID-only callbacks cannot certify
  // contextBridge authority, cross-realm Function identity or frozen copies.
  NSDictionary *candidate = @{
    @"transport": @"shared-page-mutable-DOM-event",
    @"pageAuthoredProxy": @YES,
    @"synchronousPrimitiveObserved": @(syncCandidate),
    @"synchronousThrowObserved": @([firstPage[@"synchronousThrow"] isEqual:@YES]),
    @"callbackByIdOnlyObserved": @([firstPage[@"callbackByPageId"] isEqual:@YES]),
    @"pageCanForgeResponse": @([firstPage[@"pageCanForgeDOMReply"] isEqual:@YES]),
    @"pageCanInduceNativeMessage": @(pageInducedNative),
    @"pageInitiatorAuthenticated": @NO,
    @"privilegedSenderAttested": @NO,
    @"secureContextBridgeVerified": @NO,
    @"realCallbackIdentityVerified": @NO,
    @"promiseProxyVerified": @NO,
    @"frozenCrossRealmCopyVerified": @NO,
  };
  NSDictionary *result = @{
    @"probe": @"m0-isolated-sync-feasibility",
    @"status": @"PASS",
    @"compatible": @NO,
    @"contextBridge": @"NOT_IMPLEMENTED",
    @"compatibilityGate": @"OPEN",
    @"nativeReplyCount": @(self.nativeReplyCount),
    @"documentStartNativeMessageCount": @(self.documentStartNativeMessageCount),
    @"pageInducedNativeMessageCount": @(self.pageInducedNativeMessageCount),
    @"withReplyReturnedPromise": @([firstIsolated[@"nativeReplyPromise"] isEqual:@YES]),
    @"nativeReplySettled": @([firstIsolated[@"nativeReplySettled"] isEqual:@YES]),
    @"documentLoads": @(self.navigations),
    @"newDocumentScriptReinitialized": @(replayReset),
    @"candidate": candidate,
    @"firstDocument": @{@"page": firstPage, @"isolated": firstIsolated},
    @"secondDocument": @{@"page": page, @"isolated": isolated},
    @"environment": @{
      @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
      @"webkit": [[NSBundle bundleForClass:[WKWebView class]]
          objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown"
    },
  };
  [self.webView.configuration.userContentController removeScriptMessageHandlerForName:
    @"electronMbtM0NativeReply" contentWorld:self.isolatedWorld];
  [self.webView.configuration.userContentController removeAllUserScripts];
  self.webView.navigationDelegate = nil;
  [self.webView stopLoading];
  [self.window close];
  finish(result, 0);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)navigation;
  self.navigations += 1;
  NSUInteger stage = self.navigations;
  if (stage > 2) { [self fail:@"ELECTRON_MBT_M0_EXCESS_NAVIGATIONS"]; return; }
  __weak M0BridgeProbe *weakSelf = self;
  [webView evaluateJavaScript:@"JSON.stringify(globalThis.m0PageFirstScript)"
    inFrame:nil inContentWorld:[WKContentWorld pageWorld]
    completionHandler:^(id pageResult, NSError *pageError) {
      M0BridgeProbe *probe = weakSelf;
      if (!probe) return;
      NSDictionary *page = pageError ? nil : decodeObject(pageResult);
      if (!page) { [probe fail:@"ELECTRON_MBT_M0_PAGE_OBSERVATION"]; return; }
      NSString *script = @"JSON.stringify({"
        @"isolatedMarker:globalThis.electronMbtM0IsolatedOnly?.isolatedMarker === true,"
        @"requests:globalThis.electronMbtM0IsolatedOnly?.requests ?? -1,"
        @"callbackAttempts:globalThis.electronMbtM0IsolatedOnly?.callbackAttempts ?? -1,"
        @"primordialIntact:globalThis.electronMbtM0IsolatedOnly?.primordialIntact === true,"
        @"nativeReplyPromise:globalThis.electronMbtM0IsolatedOnly?.nativeReplyPromise === true,"
        @"nativeReplySettled:globalThis.electronMbtM0IsolatedOnly?.nativeReplySettled === true,"
        @"nativePageRequestCount:globalThis.electronMbtM0IsolatedOnly?.nativePageRequestCount ?? -1,"
        @"nativePageReplySettled:globalThis.electronMbtM0IsolatedOnly?.nativePageReplySettled === true"
        @"})";
      [probe.webView evaluateJavaScript:script inFrame:nil
        inContentWorld:probe.isolatedWorld
        completionHandler:^(id isolatedResult, NSError *isolatedError) {
          M0BridgeProbe *live = weakSelf;
          if (!live) return;
          NSDictionary *isolated = isolatedError ? nil : decodeObject(isolatedResult);
          if (!isolated) { [live fail:@"ELECTRON_MBT_M0_ISOLATED_OBSERVATION"]; return; }
          [live completeStage:stage page:page isolated:isolated];
        }];
    }];
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)nav
      withError:(NSError *)error {
  (void)webView; (void)nav; (void)error;
  [self fail:@"ELECTRON_MBT_M0_LOAD_FAILED"];
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)nav
      withError:(NSError *)error {
  (void)webView; (void)nav; (void)error;
  [self fail:@"ELECTRON_MBT_M0_LOAD_FAILED"];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  (void)webView;
  [self fail:@"ELECTRON_MBT_M0_CONTENT_TERMINATED"];
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) {
      finish(@{@"probe": @"m0-isolated-sync-feasibility", @"status": @"FAIL",
        @"code": @"ELECTRON_MBT_M0_USAGE"}, 1);
    }
    NSError *error = nil;
    NSString *preloadPath = [NSString stringWithUTF8String:argv[2]];
    NSString *source = [NSString stringWithContentsOfFile:preloadPath
      encoding:NSUTF8StringEncoding error:&error];
    if (!source || error) {
      finish(@{@"probe": @"m0-isolated-sync-feasibility", @"status": @"FAIL",
        @"code": @"ELECTRON_MBT_M0_PRELOAD_SOURCE"}, 1);
    }
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    M0BridgeProbe *probe = [[M0BridgeProbe alloc] init];
    probe.pageURL = [NSURL fileURLWithPath:[[NSString stringWithUTF8String:argv[1]]
      stringByResolvingSymlinksInPath]];
    probe.preloadSource = source;
    [probe start];
    [NSApp run];
  }
  return 1;
}
