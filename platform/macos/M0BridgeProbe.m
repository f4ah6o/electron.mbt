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
@property(nonatomic, strong) NSURL *subframeURL;
@property(nonatomic, copy) NSString *subframeSource;
@property(nonatomic, strong) WKFrameInfo *subframeInfo;
@property(nonatomic, copy) NSString *preloadSource;
@property(nonatomic, strong) NSDictionary *initialPage;
@property(nonatomic, strong) NSDictionary *initialIsolated;
@property(nonatomic, strong) NSDictionary *initialSubframe;
@property(nonatomic) NSUInteger navigations;
@property(nonatomic) NSUInteger nativeReplyCount;
@property(nonatomic) NSUInteger documentStartNativeMessageCount;
@property(nonatomic) NSUInteger pageInducedNativeMessageCount;
@property(nonatomic) NSUInteger nativeSubframeDeniedCount;
@property(nonatomic, copy) NSString *documentGrant;
@property(nonatomic, copy) NSString *previousDocumentGrant;
@property(nonatomic) NSUInteger nativeGrantIssuedCount;
@property(nonatomic) NSUInteger nativeGrantAcceptedCount;
@property(nonatomic) NSUInteger nativeGrantInvalidRejectedCount;
@property(nonatomic) NSUInteger nativeGrantStaleRejectedCount;
@property(nonatomic) BOOL rejectedUnexpectedSender;
- (void)start;
- (void)captureStage:(NSUInteger)stage attempt:(NSUInteger)attempt;
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
  // Why not: the main-frame-only preload cannot exercise the child frame.
  // This separate diagnostic has no privileged renderer operation.
  WKUserScript *subframeScript = [[WKUserScript alloc] initWithSource:self.subframeSource
    injectionTime:WKUserScriptInjectionTimeAtDocumentStart
    forMainFrameOnly:NO inContentWorld:self.isolatedWorld];
  [controller addUserScript:subframeScript];
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
  // Why not: a child frame's isolated world is not the privileged main frame.
  // Match WKFrameInfo's real URL rather than trusting a claimed JS source.
  BOOL directSubframeProbe = message.webView == self.webView &&
    message.frameInfo != nil && !message.frameInfo.isMainFrame &&
    [message.frameInfo.request.URL isEqual:self.subframeURL] &&
    [message.name isEqualToString:@"electronMbtM0NativeReply"] &&
    [message.body isKindOfClass:[NSDictionary class]] &&
    [message.body[@"probe"] isEqual:@"m0"] &&
    [message.body[@"source"] isEqual:@"document-start"];
  if (directSubframeProbe) {
    self.nativeSubframeDeniedCount += 1;
    self.subframeInfo = message.frameInfo;
    replyHandler(nil, @"ELECTRON_MBT_UNEXPECTED_M0_SENDER");
    return;
  }
  NSString *claimedSource = [message.body isKindOfClass:[NSDictionary class]] ?
    message.body[@"source"] : nil;
  BOOL knownSource = [claimedSource isKindOfClass:[NSString class]] &&
    ([claimedSource isEqualToString:@"document-start"] ||
     [claimedSource isEqualToString:@"dom-triggered"] ||
     [claimedSource isEqualToString:@"grant-valid"] ||
     [claimedSource isEqualToString:@"grant-invalid"] ||
     [claimedSource isEqualToString:@"grant-stale"]);
  BOOL valid = message.webView == self.webView && message.frameInfo.isMainFrame &&
    [message.name isEqualToString:@"electronMbtM0NativeReply"] &&
    [message.body isKindOfClass:[NSDictionary class]] &&
    [message.body[@"probe"] isEqual:@"m0"] && knownSource;
  if (!valid) {
    self.rejectedUnexpectedSender = YES;
    replyHandler(nil, @"ELECTRON_MBT_UNEXPECTED_M0_SENDER");
    return;
  }
  // Why not: a shared-DOM event or a caller-supplied "source" string cannot
  // attest the page initiator, even when the native frame is the main frame.
  if ([claimedSource hasPrefix:@"grant-"]) {
    NSString *grant = [message.body[@"grant"] isKindOfClass:[NSString class]] ?
      message.body[@"grant"] : nil;
    BOOL current = grant && self.documentGrant &&
      [grant isEqualToString:self.documentGrant];
    if (current) {
      if ([claimedSource isEqualToString:@"grant-valid"])
        self.nativeGrantAcceptedCount += 1;
      replyHandler(@"grant-ack", nil);
      return;
    }
    if ([claimedSource isEqualToString:@"grant-invalid"])
      self.nativeGrantInvalidRejectedCount += 1;
    if ([claimedSource isEqualToString:@"grant-stale"] &&
        self.previousDocumentGrant &&
        [grant isEqualToString:self.previousDocumentGrant])
      self.nativeGrantStaleRejectedCount += 1;
    replyHandler(nil, @"ELECTRON_MBT_M0_DOCUMENT_GRANT_DENIED");
    return;
  }
  self.nativeReplyCount += 1;
  if ([claimedSource isEqualToString:@"dom-triggered"]) {
    self.pageInducedNativeMessageCount += 1;
    replyHandler(@"native-ack", nil);
    return;
  }
  if (!self.documentGrant) {
    replyHandler(nil, @"ELECTRON_MBT_M0_DOCUMENT_NOT_READY");
    return;
  }
  self.documentStartNativeMessageCount += 1;
  // Why not: previousGrant is exposed only to the isolated test realm to
  // exercise replay rejection. Neither token is placed in shared DOM/JSON logs.
  replyHandler(@{@"reply": @"native-ack",
    @"documentGrant": self.documentGrant,
    @"previousGrant": self.previousDocumentGrant ?: [NSNull null]}, nil);
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  // Why not: a page redirect or subframe cannot become a privileged test sender.
  BOOL mainFrame = action.targetFrame != nil && action.targetFrame.isMainFrame &&
    [action.request.URL isEqual:self.pageURL];
  BOOL childFrame = action.targetFrame != nil && !action.targetFrame.isMainFrame &&
    [action.request.URL isEqual:self.subframeURL];
  BOOL allowed = mainFrame || childFrame;
  if (mainFrame) {
    self.previousDocumentGrant = self.documentGrant;
    self.documentGrant = [NSUUID UUID].UUIDString;
    self.nativeGrantIssuedCount += 1;
  }
  decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
  if (!allowed) [self fail:@"ELECTRON_MBT_M0_NAVIGATION_DENIED"];
}

- (void)completeStage:(NSUInteger)stage page:(NSDictionary *)page
          isolated:(NSDictionary *)isolated subframe:(NSDictionary *)subframe {
  if (![subframe[@"attempted"] isEqual:@YES] ||
      ![subframe[@"replyPromise"] isEqual:@YES] ||
      ![subframe[@"settled"] isEqual:@YES] ||
      ![subframe[@"denied"] isEqual:@YES] ||
      ![subframe[@"rejectionCodeObserved"] isEqual:@YES]) {
    [self fail:@"ELECTRON_MBT_M0_SUBFRAME_DENIAL_FAILED"];
    return;
  }
  if (stage == 1) {
    self.initialPage = page;
    self.initialIsolated = isolated;
    self.initialSubframe = subframe;
    self.subframeInfo = nil;
    [self.webView reload];
    return;
  }
  if (stage != 2 || !self.initialPage || !self.initialIsolated || !self.initialSubframe) {
    [self fail:@"ELECTRON_MBT_M0_UNEXPECTED_DOCUMENT_STATE"];
    return;
  }
  NSDictionary *firstPage = self.initialPage;
  NSDictionary *firstIsolated = self.initialIsolated;
  NSDictionary *firstSubframe = self.initialSubframe;
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
  BOOL grantsRotated = self.nativeGrantIssuedCount == 2 &&
    self.previousDocumentGrant != nil &&
    ![self.previousDocumentGrant isEqualToString:self.documentGrant];
  BOOL grantEcho = [firstIsolated[@"grantEchoAccepted"] isEqual:@YES] &&
    [isolated[@"grantEchoAccepted"] isEqual:@YES] &&
    self.nativeGrantAcceptedCount == 2;
  BOOL invalidGrantDenied = [firstIsolated[@"invalidGrantRejected"] isEqual:@YES] &&
    [isolated[@"invalidGrantRejected"] isEqual:@YES] &&
    self.nativeGrantInvalidRejectedCount == 2;
  BOOL staleGrantDenied = grantsRotated &&
    [isolated[@"staleGrantRejected"] isEqual:@YES] &&
    self.nativeGrantStaleRejectedCount == 1;
  BOOL subframeDenied = self.nativeSubframeDeniedCount == 2 &&
    [firstSubframe[@"denied"] isEqual:@YES] &&
    [subframe[@"denied"] isEqual:@YES] &&
    [firstSubframe[@"rejectionCodeObserved"] isEqual:@YES] &&
    [subframe[@"rejectionCodeObserved"] isEqual:@YES];
  if (!subframeDenied) {
    [self fail:@"ELECTRON_MBT_M0_SUBFRAME_REJECTION_COUNT"];
    return;
  }
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
    @"documentGrantRotated": @(grantsRotated),
    @"isolatedGrantEchoObserved": @(grantEcho),
    @"invalidGrantRejected": @(invalidGrantDenied),
    @"staleGrantReplayRejected": @(staleGrantDenied),
    @"directSubframeNativeDenied": @(subframeDenied),
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
    @"nativeSubframeDeniedCount": @(self.nativeSubframeDeniedCount),
    @"nativeGrantIssuedCount": @(self.nativeGrantIssuedCount),
    @"nativeGrantAcceptedCount": @(self.nativeGrantAcceptedCount),
    @"nativeGrantInvalidRejectedCount": @(self.nativeGrantInvalidRejectedCount),
    @"nativeGrantStaleRejectedCount": @(self.nativeGrantStaleRejectedCount),
    @"withReplyReturnedPromise": @([firstIsolated[@"nativeReplyPromise"] isEqual:@YES]),
    @"nativeReplySettled": @([firstIsolated[@"nativeReplySettled"] isEqual:@YES]),
    @"documentLoads": @(self.navigations),
    @"newDocumentScriptReinitialized": @(replayReset),
    @"candidate": candidate,
    @"firstDocument": @{@"page": firstPage, @"isolated": firstIsolated, @"subframe": firstSubframe},
    @"secondDocument": @{@"page": page, @"isolated": isolated, @"subframe": subframe},
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

- (void)retryStage:(NSUInteger)stage attempt:(NSUInteger)attempt {
  if (attempt >= 40) {
    [self fail:@"ELECTRON_MBT_M0_SUBFRAME_OR_GRANT_TIMEOUT"];
    return;
  }
  __weak M0BridgeProbe *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC),
    dispatch_get_main_queue(), ^{
      M0BridgeProbe *probe = weakSelf;
      if (probe) [probe captureStage:stage attempt:attempt + 1];
    });
}

- (void)captureStage:(NSUInteger)stage attempt:(NSUInteger)attempt {
  __weak M0BridgeProbe *weakSelf = self;
  [self.webView evaluateJavaScript:@"JSON.stringify(globalThis.m0PageFirstScript)"
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
        @"nativePageReplySettled:globalThis.electronMbtM0IsolatedOnly?.nativePageReplySettled === true,"
        @"grantProbeSettled:globalThis.electronMbtM0IsolatedOnly?.grantProbeSettled === true,"
        @"grantEchoAccepted:globalThis.electronMbtM0IsolatedOnly?.grantEchoAccepted === true,"
        @"invalidGrantRejected:globalThis.electronMbtM0IsolatedOnly?.invalidGrantRejected === true,"
        @"staleGrantRejected:globalThis.electronMbtM0IsolatedOnly?.staleGrantRejected === true"
        @"})";
      [probe.webView evaluateJavaScript:script inFrame:nil
        inContentWorld:probe.isolatedWorld
        completionHandler:^(id isolatedResult, NSError *isolatedError) {
          M0BridgeProbe *live = weakSelf;
          if (!live) return;
          NSDictionary *isolated = isolatedError ? nil : decodeObject(isolatedResult);
          if (!isolated) { [live fail:@"ELECTRON_MBT_M0_ISOLATED_OBSERVATION"]; return; }
          if (![isolated[@"grantProbeSettled"] isEqual:@YES] ||
              !live.subframeInfo || live.nativeSubframeDeniedCount < stage) {
            [live retryStage:stage attempt:attempt];
            return;
          }
          NSString *subframeScript = @"JSON.stringify({"
            @"attempted:globalThis.electronMbtM0SubframeOnly?.attempted === true,"
            @"replyPromise:globalThis.electronMbtM0SubframeOnly?.replyPromise === true,"
            @"settled:globalThis.electronMbtM0SubframeOnly?.settled === true,"
            @"denied:globalThis.electronMbtM0SubframeOnly?.denied === true,"
            @"rejectionCodeObserved:globalThis.electronMbtM0SubframeOnly?.rejectionCodeObserved === true"
            @"})";
          [live.webView evaluateJavaScript:subframeScript
            inFrame:live.subframeInfo inContentWorld:live.isolatedWorld
            completionHandler:^(id subframeResult, NSError *subframeError) {
              M0BridgeProbe *latest = weakSelf;
              if (!latest) return;
              NSDictionary *subframe = subframeError ? nil : decodeObject(subframeResult);
              if (!subframe || ![subframe[@"settled"] isEqual:@YES]) {
                [latest retryStage:stage attempt:attempt];
                return;
              }
              [latest completeStage:stage page:page isolated:isolated subframe:subframe];
            }];
        }];
    }];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)webView; (void)navigation;
  self.navigations += 1;
  NSUInteger stage = self.navigations;
  if (stage > 2) { [self fail:@"ELECTRON_MBT_M0_EXCESS_NAVIGATIONS"]; return; }
  [self captureStage:stage attempt:0];
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
    if (argc != 4) {
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
    NSString *subframePath = [NSString stringWithUTF8String:argv[3]];
    NSString *subframeSource = [NSString stringWithContentsOfFile:subframePath
      encoding:NSUTF8StringEncoding error:&error];
    if (!subframeSource || error) {
      finish(@{@"probe": @"m0-isolated-sync-feasibility", @"status": @"FAIL",
        @"code": @"ELECTRON_MBT_M0_SUBFRAME_SOURCE"}, 1);
    }
    probe.pageURL = [NSURL fileURLWithPath:[[NSString stringWithUTF8String:argv[1]]
      stringByResolvingSymlinksInPath]];
    probe.subframeURL = [probe.pageURL.URLByDeletingLastPathComponent
      URLByAppendingPathComponent:@"m0-frame.html"];
    probe.preloadSource = source;
    probe.subframeSource = subframeSource;
    [probe start];
    [NSApp run];
  }
  return 1;
}
