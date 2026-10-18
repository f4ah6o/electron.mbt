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

static NSNumber *boolValue(BOOL value) {
  return value ? @YES : @NO;
}

static BOOL dictBool(NSDictionary *dictionary, NSString *key) {
  return [dictionary isKindOfClass:[NSDictionary class]] &&
    [dictionary[key] isEqual:@YES];
}

static BOOL dictFalse(NSDictionary *dictionary, NSString *key) {
  return [dictionary isKindOfClass:[NSDictionary class]] &&
    [dictionary[key] isEqual:@NO];
}

static NSString *dictString(NSDictionary *dictionary, NSString *key) {
  id value = [dictionary isKindOfClass:[NSDictionary class]] ? dictionary[key] : nil;
  return [value isKindOfClass:[NSString class]] ? value : nil;
}

static BOOL validErrorEvidence(id value) {
  NSDictionary *error = value;
  return [error isKindOfClass:[NSDictionary class]] &&
    [error[@"name"] isEqual:@"Error"] &&
    [error[@"typeofValue"] isEqual:@"object"] &&
    [error[@"objectTag"] isEqual:@"[object Error]"] &&
    [error[@"pageRealmInstance"] isEqual:@YES];
}

static BOOL validOracleObservation(NSDictionary *observed, NSString **reason) {
  if (![observed isKindOfClass:[NSDictionary class]]) {
    if (reason) *reason = @"oracle observation is missing";
    return NO;
  }
  if (observed[@"fixtureError"] != nil) {
    if (reason) *reason = @"oracle page reported fixtureError";
    return NO;
  }
  if (!dictBool(observed, @"availableAtFirstScript")) {
    if (reason) *reason = @"window.fixture was not available at the first script";
    return NO;
  }
  if (![observed[@"syncValue"] isEqual:@42]) {
    if (reason) *reason = @"syncValue was not the synchronous number 42";
    return NO;
  }
  if (!dictBool(observed, @"syncThrow")) {
    if (reason) *reason = @"syncThrow did not throw the pinned Error synchronously";
    return NO;
  }
  if (!validErrorEvidence(observed[@"syncThrowError"])) {
    if (reason) *reason = @"syncThrow error realm evidence mismatched";
    return NO;
  }
  if (!dictBool(observed, @"returnsPromise")) {
    if (reason) *reason = @"promiseValue did not return a page Promise";
    return NO;
  }
  if (![observed[@"promiseValue"] isEqual:@43]) {
    if (reason) *reason = @"Promise did not fulfill with 43";
    return NO;
  }
  if (!dictBool(observed, @"promiseReject")) {
    if (reason) *reason = @"Promise rejection was not observed";
    return NO;
  }
  if (!validErrorEvidence(observed[@"promiseRejectError"])) {
    if (reason) *reason = @"Promise rejection error realm evidence mismatched";
    return NO;
  }
  if (!dictBool(observed, @"dataFrozen") || !dictBool(observed, @"dataUnchanged")) {
    if (reason) *reason = @"exposed data was not frozen/copied";
    return NO;
  }
  if (![observed[@"callbackValues"] isEqual:@[@"first", @"second"]]) {
    if (reason) *reason = @"callback values mismatched the pinned observation";
    return NO;
  }
  if (!dictFalse(observed, @"callbackRemovalByOriginalIdentity")) {
    if (reason) *reason = @"callback removal identity diverged from the pinned observation";
    return NO;
  }
  if (!dictBool(observed, @"disposerIsFunction")) {
    if (reason) *reason = @"subscription disposer was not a function";
    return NO;
  }
  if (!dictBool(observed, @"disposeOnce") || !dictFalse(observed, @"disposeTwice")) {
    if (reason) *reason = @"disposer once/twice behavior mismatched";
    return NO;
  }
  if (![observed[@"subscriptionValues"] isEqual:@[@"sub-first"]]) {
    if (reason) *reason = @"subscription values mismatched the pinned observation";
    return NO;
  }
  if (!dictBool(observed, @"primordialIntact")) {
    if (reason) *reason = @"isolated primordials were affected by page tampering";
    return NO;
  }
  return YES;
}

static BOOL validCheckpointState(NSDictionary *state, NSDictionary *scan, NSString **reason) {
  if (![state isKindOfClass:[NSDictionary class]]) {
    if (reason) *reason = @"checkpoint 1 page state is missing";
    return NO;
  }
  if (!dictBool(state, @"firstScriptAttempted") || !dictBool(state, @"apiAvailable")) {
    if (reason) *reason = @"window.fixture was not available at the first script";
    return NO;
  }
  if (![state[@"syncValue"] isEqual:@42] || ![dictString(state, @"syncValueType") isEqual:@"number"]) {
    if (reason) *reason = @"syncValue was not the synchronous number 42";
    return NO;
  }
  if (!dictBool(state, @"syncThrow") || !validErrorEvidence(state[@"syncThrowError"])) {
    if (reason) *reason = @"syncThrow/error realm evidence mismatched";
    return NO;
  }
  if (dictBool(state, @"preSeededForgedAccepted") ||
      dictBool(state, @"listenerForgedAccepted") ||
      dictBool(state, @"captureBlockedForgedAccepted") ||
      dictBool(state, @"afterListenerForgedAccepted")) {
    if (reason) *reason = @"a page forged synchronous reply was accepted";
    return NO;
  }
  if (!dictBool(state, @"bridgeInternalsHidden") || !dictBool(state, @"nativeHandlersHidden")) {
    if (reason) *reason = @"page world could see bridge internals or native handlers";
    return NO;
  }
  if (![scan isKindOfClass:[NSDictionary class]]) {
    if (reason) *reason = @"secret scan did not return a result";
    return NO;
  }
  if (dictBool(scan, @"inDom") || dictBool(scan, @"inStorage") ||
      dictBool(scan, @"inGlobals") || dictBool(scan, @"inExposed")) {
    if (reason) *reason = @"bridge secret was observable from page world";
    return NO;
  }
  return YES;
}

static BOOL validNegativeState(NSDictionary *state, NSString **reason) {
  if (![state isKindOfClass:[NSDictionary class]]) {
    if (reason) *reason = @"negative page state is missing";
    return NO;
  }
  NSArray *required = @[
    @"complete", @"nestedReentrant", @"callbackThrowReconstructed",
    @"bridgeUnaffected", @"unsupportedRejected", @"oversizeRejected",
    @"cyclicRejected", @"childAccessDenied", @"childMessageObserved",
    @"childOpaqueOrigin", @"childNotRelayed", @"handlerHidden", @"internalsHidden",
  ];
  for (NSString *key in required) {
    if (!dictBool(state, key)) {
      if (reason) *reason = [NSString stringWithFormat:@"negative observation missing: %@", key];
      return NO;
    }
  }
  if (dictBool(state, @"secretVisible")) {
    if (reason) *reason = @"negative page observed the bridge secret";
    return NO;
  }
  return YES;
}

@interface M0ContextBridgeProbe : NSObject <WKNavigationDelegate, WKScriptMessageHandlerWithReply, WKScriptMessageHandler>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKContentWorld *isolatedWorld;
@property(nonatomic, strong) NSURL *checkpointURL;
@property(nonatomic, strong) NSURL *oracleURL;
@property(nonatomic, strong) NSURL *negativeURL;
@property(nonatomic, strong) NSURL *childURL;
@property(nonatomic, copy) NSString *preloadSource;
@property(nonatomic, copy) NSString *pageShimSource;
@property(nonatomic, copy) NSString *isolatedSource;
@property(nonatomic, copy) NSString *codecSource;
@property(nonatomic, copy) NSString *secret;
@property(nonatomic) NSUInteger navigations;
@property(nonatomic) NSUInteger pendingStage;
@property(nonatomic) NSUInteger stage;
@property(nonatomic, copy) NSString *currentGrant;
@property(nonatomic, copy) NSString *previousGrant;
@property(nonatomic, strong) NSDictionary *checkpointReportValue;
@property(nonatomic, strong) NSDictionary *checkpointState;
@property(nonatomic, strong) NSDictionary *checkpointScan;
@property(nonatomic, strong) NSDictionary *oracleFirst;
@property(nonatomic, strong) NSDictionary *oracleReload;
@property(nonatomic, strong) NSDictionary *negativeState;
@property(nonatomic) BOOL checkpointStateCaptured;
@property(nonatomic) BOOL checkpointScanCaptured;
@property(nonatomic) BOOL checkpointReportSeen;
@property(nonatomic) BOOL oracleFirstSeen;
@property(nonatomic) BOOL oracleReloadSeen;
@property(nonatomic) BOOL staleGrantTested;
@property(nonatomic) BOOL checkpointAdvanceHandled;
@property(nonatomic) BOOL stageTwoAdvanceHandled;
@property(nonatomic) BOOL stageThreeAdvanceHandled;
@property(nonatomic) BOOL negativeAdvanceHandled;
@property(nonatomic) BOOL finished;
@property(nonatomic) BOOL secretLeakDetected;
@property(nonatomic) NSUInteger reportsAccepted;
@property(nonatomic) NSUInteger reportsRejected;
@property(nonatomic) NSUInteger duplicateReportsRejected;
@property(nonatomic) NSUInteger staleGrantRejected;
@property(nonatomic) NSUInteger childReportsRejected;
@property(nonatomic) NSUInteger grantsIssued;
@property(nonatomic) NSUInteger documentHandshakes;
- (void)start;
- (void)loadCheckpoint;
- (void)loadOracle;
- (void)reloadOracle;
- (void)loadNegative;
- (NSURL *)expectedURLForStage:(NSUInteger)stage;
- (void)captureCheckpointAttempt:(NSUInteger)attempt;
- (void)captureNegativeAttempt:(NSUInteger)attempt;
- (void)runSecretScanForStage:(NSUInteger)stage attempt:(NSUInteger)attempt;
- (void)runStaleGrantTest;
- (void)maybeAdvance;
- (NSDictionary *)checkpointOneResultDictionary;
- (void)finalizeWithDecision:(NSString *)decision reason:(NSString *)reason;
- (void)fail:(NSString *)code;
@end

@implementation M0ContextBridgeProbe

- (void)fail:(NSString *)code {
  if (self.finished) return;
  self.finished = YES;
  finish(@{@"probe": @"m0-context-bridge-spike", @"status": @"FAIL",
    @"code": code, @"compatible": @NO, @"compatibilityGate": @"OPEN",
    @"productionContextBridge": @"NOT_IMPLEMENTED"}, 1);
}

- (NSString *)quoted:(NSString *)value {
  NSData *data = [NSJSONSerialization dataWithJSONObject:@[value] options:0 error:NULL];
  NSString *json = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  if (json.length < 2) return @"\"\"";
  return [json substringWithRange:NSMakeRange(1, json.length - 2)];
}

- (void)start {
  self.isolatedWorld = [WKContentWorld worldWithName:@"electron.mbt.m0.cb.isolated"];
  WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
  config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  WKUserContentController *controller = config.userContentController;
  [controller addScriptMessageHandlerWithReply:self contentWorld:self.isolatedWorld
                                          name:@"electronMbtM0CbDocument"];
  [controller addScriptMessageHandler:self contentWorld:self.isolatedWorld
                                 name:@"electronMbtM0CbReport"];
  NSString *pageScript = [NSString stringWithFormat:
    @"(function(__m0Secret){\n%@\n%@\n})(\"%@\");",
    self.codecSource, self.pageShimSource, self.secret];
  NSString *isolatedScript = [NSString stringWithFormat:
    @"(function(__m0Secret){\n%@\n%@\n"
     "(function(){"
     "const bridge = globalThis.__m0CbBridge;"
     "delete globalThis.__m0CbBridge;"
     "const electron = {contextBridge:{exposeInMainWorld:bridge.exposeInMainWorld},"
     "ipcRenderer:{send:bridge.send}};"
     "const module = {exports:{}};"
     "const require = function(name){"
     "if (name === 'electron') return electron;"
     "const error = new Error('ELECTRON_MBT_UNSUPPORTED_PRELOAD_MODULE: ' + name);"
     "error.code = 'ELECTRON_MBT_UNSUPPORTED_PRELOAD_MODULE';"
     "throw error;"
     "};"
     "(function(module, exports, require){\n%@\n})(module, module.exports, require);"
     "})();\n"
     "})(\"%@\");",
    self.codecSource, self.isolatedSource, self.preloadSource, self.secret];
  WKUserScript *pageShim = [[WKUserScript alloc] initWithSource:pageScript
    injectionTime:WKUserScriptInjectionTimeAtDocumentStart
    forMainFrameOnly:YES inContentWorld:[WKContentWorld pageWorld]];
  WKUserScript *isolated = [[WKUserScript alloc] initWithSource:isolatedScript
    injectionTime:WKUserScriptInjectionTimeAtDocumentStart
    forMainFrameOnly:YES inContentWorld:self.isolatedWorld];
  [controller addUserScript:pageShim];
  [controller addUserScript:isolated];
  self.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 640, 480)
                                    configuration:config];
  self.webView.navigationDelegate = self;
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 640, 480)
    styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  self.window.releasedWhenClosed = NO;
  self.window.contentView = self.webView;
  self.window.title = @"M0 B5 contextBridge spike";
  [self.window orderFront:nil];
  __weak M0ContextBridgeProbe *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC),
                 dispatch_get_main_queue(), ^{
    M0ContextBridgeProbe *probe = weakSelf;
    if (probe && !probe.finished) [probe fail:@"ELECTRON_MBT_M0_CB_TIMEOUT"];
  });
  [self loadCheckpoint];
}

- (void)loadCheckpoint {
  self.pendingStage = 1;
  [self.webView loadFileURL:self.checkpointURL
     allowingReadAccessToURL:self.checkpointURL.URLByDeletingLastPathComponent];
}

- (void)loadOracle {
  self.pendingStage = self.oracleFirst == nil ? 2 : 3;
  [self.webView loadFileURL:self.oracleURL
     allowingReadAccessToURL:self.oracleURL.URLByDeletingLastPathComponent];
}

- (void)reloadOracle {
  self.pendingStage = 3;
  [self.webView reload];
}

- (void)loadNegative {
  self.pendingStage = 4;
  [self.webView loadFileURL:self.negativeURL
     allowingReadAccessToURL:self.negativeURL.URLByDeletingLastPathComponent];
}

- (NSURL *)expectedURLForStage:(NSUInteger)stage {
  if (stage == 1) return self.checkpointURL;
  if (stage == 2 || stage == 3) return self.oracleURL;
  if (stage == 4) return self.negativeURL;
  return nil;
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  NSURL *url = action.request.URL;
  BOOL mainFrame = action.targetFrame != nil && action.targetFrame.isMainFrame;
  BOOL childFrame = action.targetFrame != nil && !action.targetFrame.isMainFrame;
  BOOL checkpoint = [url isEqual:self.checkpointURL];
  BOOL oracle = [url isEqual:self.oracleURL];
  BOOL negative = [url isEqual:self.negativeURL];
  BOOL child = [url isEqual:self.childURL];
  BOOL allowed = (mainFrame && (checkpoint || oracle || negative)) ||
    (childFrame && child);
  if (mainFrame && (checkpoint || oracle || negative)) {
    self.previousGrant = self.currentGrant;
    self.currentGrant = [NSUUID UUID].UUIDString;
    self.grantsIssued += 1;
    if (checkpoint) self.pendingStage = 1;
    else if (negative) self.pendingStage = 4;
    else self.pendingStage = self.oracleFirst == nil ? 2 : 3;
  }
  decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
  if (!allowed) [self fail:@"ELECTRON_MBT_M0_CB_NAVIGATION_DENIED"];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)webView; (void)navigation;
  self.navigations += 1;
  self.stage = self.navigations;
  NSURL *expected = [self expectedURLForStage:self.stage];
  if (expected == nil || ![self.webView.URL isEqual:expected]) {
    [self fail:@"ELECTRON_MBT_M0_CB_STAGE_URL"];
    return;
  }
  if (self.stage == 1) {
    [self captureCheckpointAttempt:0];
    [self runSecretScanForStage:1 attempt:0];
    __weak M0ContextBridgeProbe *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
      M0ContextBridgeProbe *probe = weakSelf;
      if (!probe || probe.finished) return;
      if (!probe.checkpointReportSeen) {
        [probe finalizeWithDecision:@"blocked"
          reason:@"checkpoint 1 sync/forgery evidence exists but the test report lane did not answer"];
      }
    });
  } else if (self.stage == 2) {
    __weak M0ContextBridgeProbe *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
      M0ContextBridgeProbe *probe = weakSelf;
      if (!probe || probe.finished || probe.oracleFirstSeen) return;
      [probe finalizeWithDecision:@"no-go" reason:@"oracle observation was not reported"];
    });
  } else if (self.stage == 3) {
    [self runStaleGrantTest];
    __weak M0ContextBridgeProbe *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
      M0ContextBridgeProbe *probe = weakSelf;
      if (!probe || probe.finished || probe.oracleReloadSeen) return;
      [probe finalizeWithDecision:@"no-go" reason:@"oracle reload observation was not reported"];
    });
  } else if (self.stage == 4) {
    [self captureNegativeAttempt:0];
  }
  [self maybeAdvance];
}

- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message {
  (void)controller;
  NSDictionary *body = message.body;
  BOOL valid = message.webView == self.webView &&
    [message.name isEqualToString:@"electronMbtM0CbReport"] &&
    message.frameInfo.isMainFrame &&
    [body isKindOfClass:[NSDictionary class]] &&
    [body[@"probe"] isEqual:@"m0-cb-context-bridge"] &&
    [body[@"channel"] isKindOfClass:[NSString class]] &&
    [body[@"grant"] isKindOfClass:[NSString class]] &&
    [body[@"value"] isKindOfClass:[NSDictionary class]];
  NSURL *expected = [self expectedURLForStage:self.pendingStage];
  if (valid && expected != nil && ![message.frameInfo.request.URL isEqual:expected]) valid = NO;
  if (!valid) {
    self.reportsRejected += 1;
    if (message.webView == self.webView && message.frameInfo != nil &&
        !message.frameInfo.isMainFrame) {
      self.childReportsRejected += 1;
    }
    return;
  }
  if (![body[@"grant"] isEqual:self.currentGrant]) {
    self.reportsRejected += 1;
    if (self.previousGrant != nil && [body[@"grant"] isEqual:self.previousGrant]) {
      self.staleGrantRejected += 1;
      self.staleGrantTested = YES;
    }
    return;
  }
  if (self.pendingStage == 1 && self.checkpointReportSeen) {
    self.duplicateReportsRejected += 1;
    return;
  }
  if (self.pendingStage == 2 && self.oracleFirstSeen) {
    self.duplicateReportsRejected += 1;
    return;
  }
  if (self.pendingStage == 3 && self.oracleReloadSeen) {
    self.duplicateReportsRejected += 1;
    return;
  }
  self.reportsAccepted += 1;
  if (self.pendingStage == 1) {
    self.checkpointReportValue = body[@"value"];
    self.checkpointReportSeen = YES;
  } else if (self.pendingStage == 2) {
    self.oracleFirst = body[@"value"];
    self.oracleFirstSeen = YES;
  } else if (self.pendingStage == 3) {
    self.oracleReload = body[@"value"];
    self.oracleReloadSeen = YES;
  }
  [self maybeAdvance];
}

- (void)userContentController:(WKUserContentController *)controller
      didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id _Nullable, NSString * _Nullable))replyHandler {
  (void)controller;
  NSDictionary *body = message.body;
  BOOL valid = message.webView == self.webView &&
    [message.name isEqualToString:@"electronMbtM0CbDocument"] &&
    message.frameInfo.isMainFrame &&
    [body isKindOfClass:[NSDictionary class]] &&
    [body[@"probe"] isEqual:@"m0-cb-context-bridge"] &&
    [body[@"source"] isEqual:@"document-start"] &&
    self.currentGrant != nil;
  if (!valid) {
    replyHandler(nil, @"ELECTRON_MBT_M0_CB_DOCUMENT_DENIED");
    return;
  }
  self.documentHandshakes += 1;
  replyHandler(@{@"grant": self.currentGrant}, nil);
}

- (void)runSecretScanForStage:(NSUInteger)stage attempt:(NSUInteger)attempt {
  (void)stage;
  NSString *script = [NSString stringWithFormat:
    @"(function(secret){"
     "const result = {inDom:false,inStorage:false,inGlobals:false,inExposed:false};"
     "try { const html = document.documentElement ? document.documentElement.outerHTML : '';"
     "result.inDom = html.indexOf(secret) !== -1; } catch (_) {}"
     "try {"
     "for (const storage of [localStorage, sessionStorage]) {"
     "for (let i = 0; i < storage.length; i++) {"
     "const key = storage.key(i); const value = storage.getItem(key);"
     "if ((key && key.indexOf(secret) !== -1) || (value && value.indexOf(secret) !== -1))"
     "result.inStorage = true;"
     "} } } catch (_) {}"
     "try { for (const key of Object.keys(globalThis)) {"
     "const value = globalThis[key];"
     "if (typeof value === 'string' && value.indexOf(secret) !== -1) result.inGlobals = true;"
     "else if (typeof value === 'function' && String(value).indexOf(secret) !== -1)"
     "result.inGlobals = true; } } catch (_) {}"
     "try { if (window.fixture) {"
     "for (const key of Object.keys(window.fixture)) {"
     "const value = window.fixture[key];"
     "if (typeof value === 'function' && String(value).indexOf(secret) !== -1)"
     "result.inExposed = true; }"
     "const descriptor = Object.getOwnPropertyDescriptor(window, 'fixture');"
     "if (descriptor && descriptor.get && String(descriptor.get).indexOf(secret) !== -1)"
     "result.inExposed = true; } } catch (_) {}"
     "return JSON.stringify(result);"
     "})(\"%@\")",
    self.secret];
  __weak M0ContextBridgeProbe *weakSelf = self;
  [self.webView evaluateJavaScript:script inFrame:nil
    inContentWorld:[WKContentWorld pageWorld]
    completionHandler:^(id result, NSError *error) {
      M0ContextBridgeProbe *probe = weakSelf;
      if (!probe || probe.finished) return;
      NSDictionary *scan = error ? nil : decodeObject(result);
      if (!scan) {
        if (attempt < 10) {
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC),
                         dispatch_get_main_queue(), ^{
            [probe runSecretScanForStage:1 attempt:attempt + 1];
          });
        } else {
          [probe fail:@"ELECTRON_MBT_M0_CB_SECRET_SCAN"];
        }
        return;
      }
      probe.checkpointScan = scan;
      probe.checkpointScanCaptured = YES;
      if (dictBool(scan, @"inDom") || dictBool(scan, @"inStorage") ||
          dictBool(scan, @"inGlobals") || dictBool(scan, @"inExposed")) {
        probe.secretLeakDetected = YES;
      }
      [probe maybeAdvance];
    }];
}

- (void)captureCheckpointAttempt:(NSUInteger)attempt {
  __weak M0ContextBridgeProbe *weakSelf = self;
  [self.webView evaluateJavaScript:@"JSON.stringify(globalThis.m0ContextBridgeCheckpoint1)"
    inFrame:nil inContentWorld:[WKContentWorld pageWorld]
    completionHandler:^(id result, NSError *error) {
      M0ContextBridgeProbe *probe = weakSelf;
      if (!probe || probe.finished) return;
      NSDictionary *state = error ? nil : decodeObject(result);
      if (!state) {
        if (attempt < 20) {
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC),
                         dispatch_get_main_queue(), ^{
            [probe captureCheckpointAttempt:attempt + 1];
          });
        } else {
          [probe fail:@"ELECTRON_MBT_M0_CB_CHECKPOINT_STATE"];
        }
        return;
      }
      probe.checkpointState = state;
      probe.checkpointStateCaptured = YES;
      [probe maybeAdvance];
    }];
}

- (void)captureNegativeAttempt:(NSUInteger)attempt {
  __weak M0ContextBridgeProbe *weakSelf = self;
  [self.webView evaluateJavaScript:@"JSON.stringify(globalThis.m0ContextBridgeNegative)"
    inFrame:nil inContentWorld:[WKContentWorld pageWorld]
    completionHandler:^(id result, NSError *error) {
      M0ContextBridgeProbe *probe = weakSelf;
      if (!probe || probe.finished) return;
      NSDictionary *state = error ? nil : decodeObject(result);
      if (!state || !dictBool(state, @"complete")) {
        if (attempt < 30) {
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                         dispatch_get_main_queue(), ^{
            [probe captureNegativeAttempt:attempt + 1];
          });
        } else {
          [probe finalizeWithDecision:@"no-go" reason:@"negative page observation was incomplete"];
        }
        return;
      }
      probe.negativeState = state;
      [probe maybeAdvance];
    }];
}

- (void)runStaleGrantTest {
  if (self.previousGrant == nil) return;
  NSString *script = [NSString stringWithFormat:
    @"(function(grant){"
     "const handler = window.webkit && window.webkit.messageHandlers && "
     "window.webkit.messageHandlers.electronMbtM0CbReport;"
     "if (!handler) return false;"
     "handler.postMessage({probe:'m0-cb-context-bridge',grant:grant,"
     "channel:'stale-probe',value:{stale:true}});"
     "return true;"
     "})(\"%@\")",
    self.previousGrant];
  __weak M0ContextBridgeProbe *weakSelf = self;
  [self.webView evaluateJavaScript:script inFrame:nil inContentWorld:self.isolatedWorld
    completionHandler:^(id result, NSError *error) {
      M0ContextBridgeProbe *probe = weakSelf;
      if (!probe || probe.finished) return;
      if (error || ![result isEqual:@YES]) {
        [probe fail:@"ELECTRON_MBT_M0_CB_STALE_GRANT_PROBE"];
        return;
      }
      probe.staleGrantTested = YES;
      [probe maybeAdvance];
    }];
}

- (void)maybeAdvance {
  if (self.finished) return;
  if (self.stage == 1 && self.checkpointStateCaptured && self.checkpointScanCaptured) {
    NSString *reason = nil;
    BOOL checkpointValid = validCheckpointState(self.checkpointState, self.checkpointScan, &reason) &&
      !self.secretLeakDetected;
    if (!checkpointValid) {
      if (!self.checkpointAdvanceHandled) {
        self.checkpointAdvanceHandled = YES;
        [self finalizeWithDecision:@"no-go" reason:reason ?: @"checkpoint 1 failed"];
      }
      return;
    }
    if (self.checkpointReportSeen && !self.checkpointAdvanceHandled) {
      self.checkpointAdvanceHandled = YES;
      [self loadOracle];
    }
    return;
  }
  if (self.pendingStage == 2 && self.oracleFirstSeen && self.stage == 2 &&
      !self.stageTwoAdvanceHandled) {
    self.stageTwoAdvanceHandled = YES;
    NSString *reason = nil;
    if (!validOracleObservation(self.oracleFirst, &reason)) {
      [self finalizeWithDecision:@"no-go" reason:reason];
      return;
    }
    [self reloadOracle];
    return;
  }
  if (self.pendingStage == 3 && self.oracleReloadSeen && self.staleGrantTested &&
      self.stage == 3 && !self.stageThreeAdvanceHandled) {
    self.stageThreeAdvanceHandled = YES;
    NSString *reason = nil;
    if (!validOracleObservation(self.oracleReload, &reason)) {
      [self finalizeWithDecision:@"no-go" reason:reason];
      return;
    }
    if (self.staleGrantRejected == 0) {
      [self finalizeWithDecision:@"no-go" reason:@"stale native document grant was not rejected"];
      return;
    }
    [self loadNegative];
    return;
  }
  if (self.stage == 4 && self.negativeState != nil && !self.negativeAdvanceHandled) {
    self.negativeAdvanceHandled = YES;
    NSString *reason = nil;
    if (!validNegativeState(self.negativeState, &reason) || self.secretLeakDetected) {
      [self finalizeWithDecision:@"no-go" reason:reason ?: @"negative checks failed"];
      return;
    }
    if (!self.oracleReloadSeen || self.staleGrantRejected == 0) {
      [self finalizeWithDecision:@"no-go" reason:@"navigation revocation evidence is incomplete"];
      return;
    }
    [self finalizeWithDecision:@"go" reason:nil];
  }
}

- (NSDictionary *)checkpointOneResultDictionary {
  return @{
    @"firstScript": boolValue(dictBool(self.checkpointState, @"apiAvailable")),
    @"syncValue": boolValue([self.checkpointState[@"syncValue"] isEqual:@42]),
    @"syncThrow": boolValue(dictBool(self.checkpointState, @"syncThrow")),
    @"syncValueThenable": boolValue(![dictString(self.checkpointState, @"syncValueType") isEqual:@"number"]),
    @"forgery": @{
      @"preSeededForgedAccepted": boolValue(dictBool(self.checkpointState, @"preSeededForgedAccepted")),
      @"listenerForgedAccepted": boolValue(dictBool(self.checkpointState, @"listenerForgedAccepted")),
      @"captureBlockedForgedAccepted": boolValue(dictBool(self.checkpointState, @"captureBlockedForgedAccepted")),
      @"afterListenerForgedAccepted": boolValue(dictBool(self.checkpointState, @"afterListenerForgedAccepted")),
    },
    @"secretVisible": boolValue(self.secretLeakDetected),
    @"result": boolValue(validCheckpointState(self.checkpointState, self.checkpointScan, NULL) &&
      !self.secretLeakDetected),
  };
}

- (void)finalizeWithDecision:(NSString *)decision reason:(NSString *)reason {
  if (self.finished) return;
  self.finished = YES;
  BOOL checkpointPass = validCheckpointState(self.checkpointState, self.checkpointScan, NULL) &&
    !self.secretLeakDetected;
  id checkpoint2;
  BOOL oracleFirstValid = validOracleObservation(self.oracleFirst, NULL);
  BOOL oracleReloadValid = validOracleObservation(self.oracleReload, NULL);
  BOOL negativeValid = validNegativeState(self.negativeState, NULL);
  BOOL navigationValid = self.oracleReloadSeen && self.staleGrantRejected > 0 &&
    oracleReloadValid;
  if (!checkpointPass || [decision isEqualToString:@"blocked"]) {
    checkpoint2 = @"NOT_RUN";
  } else {
    checkpoint2 = @{
      @"oracleFirst": boolValue(oracleFirstValid),
      @"oracleReload": boolValue(oracleReloadValid),
      @"negative": boolValue(negativeValid),
      @"navigationRevocation": boolValue(navigationValid),
      @"result": boolValue(oracleFirstValid && oracleReloadValid && negativeValid && navigationValid),
    };
  }
  BOOL go = [decision isEqualToString:@"go"];
  NSMutableDictionary *result = [NSMutableDictionary dictionaryWithDictionary:@{
    @"probe": @"m0-context-bridge-spike",
    @"schema": @1,
    @"status": @"PASS",
    @"decision": decision,
    @"compatible": @NO,
    @"productionContextBridge": @"NOT_IMPLEMENTED",
    @"compatibilityGate": @"OPEN",
    @"transport": @"shared-dom-synchronous-hmac",
    @"checkpoint1": [self checkpointOneResultDictionary],
    @"checkpoint2": checkpoint2,
    @"observations": @{
      @"checkpoint1": self.checkpointState ?: [NSNull null],
      @"oracleFirst": self.oracleFirst ?: [NSNull null],
      @"negative": self.negativeState ?: [NSNull null],
      @"oracleReload": self.oracleReload ?: [NSNull null],
    },
    @"native": @{
      @"reportsAccepted": @(self.reportsAccepted),
      @"reportsRejected": @(self.reportsRejected),
      @"duplicateReportsRejected": @(self.duplicateReportsRejected),
      @"staleGrantRejected": @(self.staleGrantRejected),
      @"childReportsRejected": @(self.childReportsRejected),
      @"grantsIssued": @(self.grantsIssued),
      @"grantRotated": boolValue(self.previousGrant != nil &&
        ![self.previousGrant isEqualToString:self.currentGrant]),
      @"documentHandshakes": @(self.documentHandshakes),
      @"secretLeakDetected": boolValue(self.secretLeakDetected),
    },
    @"environment": @{
      @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
      @"webkit": [[NSBundle bundleForClass:[WKWebView class]]
          objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown",
    },
    @"limitations": @[
      @"test-only shared-DOM/HMAC candidate; not Electron contextBridge",
      @"test-only CommonJS wrapper is not Electron's sandboxed preload environment",
      @"the report lane is a fixture transport and performs no privileged operation",
      @"no native sender authority beyond the test document grant",
    ],
  }];
  if (reason != nil) result[@"blockedReason"] = reason;
  if (go && !(checkpointPass && oracleFirstValid && oracleReloadValid &&
              negativeValid && navigationValid)) {
    result[@"decision"] = @"no-go";
    result[@"blockedReason"] = @"go requested without all required observations";
  }
  [self.webView.configuration.userContentController
    removeScriptMessageHandlerForName:@"electronMbtM0CbReport" contentWorld:self.isolatedWorld];
  [self.webView.configuration.userContentController
    removeScriptMessageHandlerForName:@"electronMbtM0CbDocument" contentWorld:self.isolatedWorld];
  [self.webView.configuration.userContentController removeAllUserScripts];
  self.webView.navigationDelegate = nil;
  [self.webView stopLoading];
  [self.window close];
  finish(result, 0);
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)nav
      withError:(NSError *)error {
  (void)webView; (void)nav; (void)error;
  [self fail:@"ELECTRON_MBT_M0_CB_LOAD_FAILED"];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)nav
      withError:(NSError *)error {
  (void)webView; (void)nav; (void)error;
  [self fail:@"ELECTRON_MBT_M0_CB_LOAD_FAILED"];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  (void)webView;
  [self fail:@"ELECTRON_MBT_M0_CB_CONTENT_TERMINATED"];
}

@end

static NSString *readSource(NSString *path, NSString *code) {
  if (path == nil) return nil;
  NSString *source = [NSString stringWithContentsOfFile:path
    encoding:NSUTF8StringEncoding error:NULL];
  if (source == nil || source.length == 0) {
    finish(@{@"probe": @"m0-context-bridge-spike", @"status": @"FAIL",
      @"code": code, @"compatible": @NO, @"compatibilityGate": @"OPEN",
      @"productionContextBridge": @"NOT_IMPLEMENTED"}, 1);
    return nil;
  }
  return source;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 9) {
      finish(@{@"probe": @"m0-context-bridge-spike", @"status": @"FAIL",
        @"code": @"ELECTRON_MBT_M0_CB_USAGE", @"compatible": @NO,
        @"compatibilityGate": @"OPEN",
        @"productionContextBridge": @"NOT_IMPLEMENTED"}, 1);
    }
    (void)readSource([NSString stringWithUTF8String:argv[1]], @"ELECTRON_MBT_M0_CB_CHECKPOINT_PAGE");
    (void)readSource([NSString stringWithUTF8String:argv[2]], @"ELECTRON_MBT_M0_CB_ORACLE_PAGE");
    (void)readSource([NSString stringWithUTF8String:argv[3]], @"ELECTRON_MBT_M0_CB_NEGATIVE_PAGE");
    (void)readSource([NSString stringWithUTF8String:argv[4]], @"ELECTRON_MBT_M0_CB_CHILD_PAGE");
    NSString *preload = readSource([NSString stringWithUTF8String:argv[5]],
      @"ELECTRON_MBT_M0_CB_PRELOAD");
    NSString *codec = readSource([NSString stringWithUTF8String:argv[6]],
      @"ELECTRON_MBT_M0_CB_CODEC");
    NSString *pageShim = readSource([NSString stringWithUTF8String:argv[7]],
      @"ELECTRON_MBT_M0_CB_PAGE_SHIM");
    NSString *isolated = readSource([NSString stringWithUTF8String:argv[8]],
      @"ELECTRON_MBT_M0_CB_ISOLATED_SHIM");
    if (preload.length == 0 || preload.length > 65536) {
      finish(@{@"probe": @"m0-context-bridge-spike", @"status": @"FAIL",
        @"code": @"ELECTRON_MBT_M0_CB_PRELOAD_SIZE", @"compatible": @NO,
        @"compatibilityGate": @"OPEN",
        @"productionContextBridge": @"NOT_IMPLEMENTED"}, 1);
    }
    NSMutableData *secretData = [NSMutableData dataWithLength:32];
    arc4random_buf(secretData.mutableBytes, secretData.length);
    NSMutableString *secret = [NSMutableString string];
    const unsigned char *bytes = secretData.bytes;
    for (NSUInteger index = 0; index < secretData.length; index++) {
      [secret appendFormat:@"%02x", bytes[index]];
    }
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    M0ContextBridgeProbe *probe = [[M0ContextBridgeProbe alloc] init];
    probe.checkpointURL = [NSURL fileURLWithPath:
      [[NSString stringWithUTF8String:argv[1]] stringByResolvingSymlinksInPath]];
    probe.oracleURL = [NSURL fileURLWithPath:
      [[NSString stringWithUTF8String:argv[2]] stringByResolvingSymlinksInPath]];
    probe.negativeURL = [NSURL fileURLWithPath:
      [[NSString stringWithUTF8String:argv[3]] stringByResolvingSymlinksInPath]];
    probe.childURL = [NSURL fileURLWithPath:
      [[NSString stringWithUTF8String:argv[4]] stringByResolvingSymlinksInPath]];
    probe.preloadSource = preload;
    probe.codecSource = codec;
    probe.pageShimSource = pageShim;
    probe.isolatedSource = isolated;
    probe.secret = secret;
    [probe start];
    [NSApp run];
  }
  return 1;
}
