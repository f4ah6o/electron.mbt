#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

// Gate A (issue 0001 §6.2/§16): attempt every public-API channel that could let
// page-world JavaScript synchronously invoke code in a named WKContentWorld or
// native code, and record what actually happens. This binary is evidence
// collection, not a contextBridge implementation; the report never upgrades an
// async or string-bound channel into a synchronous function proxy.

static void finish(NSDictionary *result, int code) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
  if (data != nil) { fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout); }
  exit(code);
}

@interface SyncBridgeProbe : NSObject <WKNavigationDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKUIDelegate, WKURLSchemeHandler>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKContentWorld *world;
@property(nonatomic, copy) NSURL *fixture;
@property(nonatomic, strong) NSMutableDictionary *report;
@property(nonatomic, strong) NSMutableDictionary *candidates;
@property(nonatomic, strong) NSMutableArray *nativeLog;
@property(nonatomic, strong) NSMutableArray<dispatch_block_t> *phases;
@property(nonatomic) NSUInteger phaseIndex;
@end

@implementation SyncBridgeProbe

- (void)recordNative:(NSString *)kind detail:(id)detail {
  [self.nativeLog addObject:@{@"kind": kind, @"detail": detail ?: [NSNull null],
                              @"at": @([[NSDate date] timeIntervalSince1970])}];
}

- (void)candidate:(NSString *)name body:(NSDictionary *)body {
  NSMutableDictionary *entry = [body mutableCopy];
  entry[@"attempted"] = @YES;
  self.candidates[name] = entry;
}

- (void)abort:(NSString *)code {
  finish(@{@"probe": @"wksyncbridge", @"status": @"FAIL", @"code": code,
           @"compatibilityGate": @"OPEN",
           @"candidates": self.candidates, @"nativeObservations": self.nativeLog}, 1);
}

// The outcome each candidate must produce for the no-sync-proxy verdict to
// hold on this build. An unexpected observation flips the candidate to
// 'unexpected' and the whole run to INCONCLUSIVE — the conclusion never gets
// asserted from constants alone.
- (NSString *)outcomeForCandidate:(NSString *)name
                          observed:(NSDictionary *)obs
                       expectation:(NSString **)expectation {
  BOOL unexpected = NO;
  if ([name isEqual:@"crossWorldFunctionReference"]) {
    *expectation = @"function references are 'undefined' in both directions — worlds share DOM, not JS objects";
    unexpected = !([obs[@"pageFnVisibleFromIsolated"] isEqual:@"undefined"] &&
                   [obs[@"isolatedFnVisibleFromPage"] isEqual:@"undefined"]);
  } else if ([name isEqual:@"domEventDispatchChannel"]) {
    *expectation = @"payloads may round-trip, but never callables and never a propagated throw";
    for (NSDictionary *call in obs[@"isolatedListenerCalls"] ?: @[]) {
      if ([call[@"callable"] isEqual:@YES]) unexpected = YES;
    }
    if ([obs[@"dispatcherCaughtThrow"] isEqual:@YES]) unexpected = YES;
  } else if ([name isEqual:@"sharedLocalStorage"]) {
    *expectation = @"a shared string store at most — any read/write result is data";
  } else if ([name isEqual:@"jsDialogChannel"]) {
    *expectation = @"dialogs may or may not reach the UIDelegate; they are a page-visible surface, never a world function — any observed result is data";
  } else if ([name isEqual:@"scriptMessageHandlers"]) {
    *expectation = @"delivery and reply are asynchronous Promises; nothing settles synchronously";
    unexpected = [obs[@"settledSynchronously"] isEqual:@YES] ||
                 [obs[@"plainIsPromise"] isEqual:@NO] ||
                 [obs[@"replyIsPromise"] isEqual:@NO];
  } else if ([name isEqual:@"evaluateJavaScriptAsync"]) {
    *expectation = @"the completion handler fires on a later run-loop turn";
    unexpected = [obs[@"completionOnLaterRunLoopTurn"] isEqual:@NO];
  } else if ([name isEqual:@"syncXhrToUrlSchemeHandler"]) {
    *expectation = @"whatever it returns is a status/headers/body string — never a function proxy";
  }
  return unexpected ? @"unexpected" : @"as-expected";
}

- (void)emit {
  // Score every candidate against its invariant before drawing any verdict.
  NSInteger unexpected = 0, notExecuted = 0, asExpected = 0;
  for (NSString *name in self.candidates.allKeys) {
    NSMutableDictionary *entry = [self.candidates[name] mutableCopy];
    if (![entry[@"executed"] isEqual:@YES]) {
      entry[@"outcome"] = @"not-executed";
      notExecuted++;
    } else {
      NSString *expectation = nil;
      NSString *outcome = [self outcomeForCandidate:name
                                          observed:entry[@"observed"]
                                       expectation:&expectation];
      entry[@"expectation"] = expectation;
      entry[@"outcome"] = outcome;
      if ([outcome isEqual:@"unexpected"]) unexpected++; else asExpected++;
    }
    self.candidates[name] = entry;
  }
  NSString *status = unexpected > 0 ? @"INCONCLUSIVE"
                   : notExecuted > 0 ? @"PARTIAL" : @"PASS";
  NSString *buildSdk = [NSString stringWithFormat:@"%ld.%ld",
    (long)(__MAC_OS_X_VERSION_MAX_ALLOWED / 10000),
    (long)((__MAC_OS_X_VERSION_MAX_ALLOWED / 100) % 100)];
  NSString *verdict = unexpected > 0
    ? [NSString stringWithFormat:
       @"On OS %@ / WebKit %@ / build SDK %@, %ld executed candidate(s) VIOLATED their expectations — "
       @"the observations must be reviewed before drawing any sync-proxy conclusion.",
       NSProcessInfo.processInfo.operatingSystemVersionString,
       [[NSBundle bundleForClass:[WKWebView class]] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown",
       buildSdk, (long)unexpected]
    : [NSString stringWithFormat:
       @"On OS %@ / WebKit %@ / build SDK %@ and within the %ld candidates executed here, no public "
       @"WKWebView API provided a synchronous function proxy into a named WKContentWorld. World JS "
       @"objects were mutually unreachable; every working channel was asynchronous, string/DOM-bound "
       @"without value identity or exception propagation, or a page-visible UI surface callable by "
       @"any script. This conclusion covers only these candidates on this build.",
       NSProcessInfo.processInfo.operatingSystemVersionString,
       [[NSBundle bundleForClass:[WKWebView class]] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown",
       buildSdk, (long)asExpected];
  NSDictionary *result = @{
    @"probe": @"wksyncbridge",
    @"status": status,
    @"compatibilityGate": @"OPEN",
    @"contextBridge": @"NO_PUBLIC_SYNC_PROXY",
    @"verdict": verdict,
    @"coverage": @{
      @"candidates": @(self.candidates.count),
      @"asExpected": @(asExpected),
      @"unexpected": @(unexpected),
      @"notExecuted": @(notExecuted),
    },
    @"preconditions": self.report[@"preconditions"] ?: [NSNull null],
    @"candidates": self.candidates,
    @"nativeObservations": self.nativeLog,
    @"apiSurfaceNotes": @[
      @"evaluateJavaScript*/callAsyncJavaScript*: every public variant delivers through a completionHandler; no blocking variant exists (demonstrated in evaluateJavaScriptAsync).",
      @"WKUserScript: one-way document-start injection; no call or return surface.",
      @"WKScriptMessageHandler/WithReply: delivery and reply are both async (Promise); demonstrated in scriptMessageHandlers.",
      @"WKURLSchemeHandler: native fulfillment is callback-driven (didReceiveResponse/Data/Finish); no synchronous reply form exists on the API surface.",
      @"JavaScriptCore JSContext is a separate VM and cannot address WKWebView content worlds.",
      @"_WKInspector and related underscored APIs are private SPI, out of scope for a public-API gate.",
    ],
    @"environment": @{@"os": NSProcessInfo.processInfo.operatingSystemVersionString,
                      @"webkit": [[NSBundle bundleForClass:[WKWebView class]] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown"},
  };
  finish(result, 0);
}

- (void)advance {
  if (self.phaseIndex >= self.phases.count) { [self emit]; return; }
  dispatch_block_t phase = self.phases[self.phaseIndex++];
  phase();
}

- (void)afterMs:(double)ms run:(dispatch_block_t)block {
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ms * NSEC_PER_MSEC)),
                 dispatch_get_main_queue(), block);
}

// Runs JS in a world, normalizing the result to a parsed JSON value or raw
// description, then continues the phase chain. Candidate failures degrade to a
// recorded error instead of aborting the evidence run.
- (void)eval:(NSString *)js
       world:(WKContentWorld *)world
        then:(void (^)(id value, NSError *error))then {
  [self.webView evaluateJavaScript:js inFrame:nil inContentWorld:world
      completionHandler:^(id result, NSError *error) {
    if (error != nil) { then(nil, error); return; }
    if ([result isKindOfClass:[NSString class]]) {
      id parsed = [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding]
                                                  options:NSJSONReadingFragmentsAllowed error:NULL];
      then(parsed ?: result, nil);
    } else {
      then(result, nil);
    }
  }];
}

- (void)start {
  self.report = [NSMutableDictionary dictionary];
  self.candidates = [NSMutableDictionary dictionary];
  self.nativeLog = [NSMutableArray array];
  self.phases = [NSMutableArray array];
  self.phaseIndex = 0;
  self.world = [WKContentWorld worldWithName:@"electron.mbt.feasibility.preload"];
  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  WKUserContentController *content = configuration.userContentController;
  // Plain handler (delivery-only) and a reply-capable handler: postMessage's
  // return type differs between them and both are evidence.
  [content addScriptMessageHandler:self contentWorld:self.world name:@"electronMbtProbe"];
  [content addScriptMessageHandlerWithReply:self contentWorld:self.world name:@"electronMbtReply"];
  [configuration setURLSchemeHandler:self forURLScheme:@"mbt"];
  NSString *preload = @"globalThis.electronMbtPreloadValue = 42;"
    @"globalThis.electronMbtOriginalMap = Array.prototype.map;"
    @"globalThis.__rpcCalls = [];"
    @"document.addEventListener('mbt-rpc', function (e) {"
    @"  var rec = { detailType: typeof e.detail, callable: typeof e.detail === 'function', at: Date.now() };"
    @"  if (typeof e.detail === 'string') rec.preview = e.detail.slice(0, 64);"
    @"  try { rec.detailTag = (e.detail && typeof e.detail === 'object') ? (e.detail.tag || null) : null; }"
    @"  catch (_) { rec.detailTag = 'unreadable'; }"
    @"  globalThis.__rpcCalls.push(rec);"
    @"  if (e.detail === 'throw-now') { throw new Error('isolated-listener-throw'); }"
    @"  document.documentElement.dataset.mbtRpcResult = 'handled:' + String(e.detail);"
    @"});"
    @"window.webkit.messageHandlers.electronMbtProbe.postMessage('started');";
  WKUserScript *script = [[WKUserScript alloc] initWithSource:preload
    injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES inContentWorld:self.world];
  [content addUserScript:script];
  self.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 640, 480) configuration:configuration];
  self.webView.navigationDelegate = self;
  self.webView.UIDelegate = self;
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 640, 480)
    styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  self.window.releasedWhenClosed = NO;
  self.window.contentView = self.webView;
  self.window.title = @"electron.mbt sync-bridge gate probe";
  [self.window orderFront:nil];

  __weak SyncBridgeProbe *weakSelf = self;
  [self.phases addObjectsFromArray:@[
    ^{ [weakSelf phasePreconditions]; },
    ^{ [weakSelf phaseCrossWorldReference]; },
    ^{ [weakSelf phaseDomEventChannel]; },
    ^{ [weakSelf phaseLocalStorage]; },
    ^{ [weakSelf phaseDialogs]; },
    ^{ [weakSelf phaseMessageHandlers]; },
    ^{ [weakSelf phaseSchemeXhr]; },
    ^{ [weakSelf phaseEvaluateAsync]; },
  ]];
  [self.webView loadFileURL:self.fixture allowingReadAccessToURL:self.fixture.URLByDeletingLastPathComponent];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [weakSelf abort:@"ELECTRON_MBT_PROBE_TIMEOUT"];
  });
}

#pragma mark - Phases

- (void)phasePreconditions {
  __weak SyncBridgeProbe *weakSelf = self;
  [self eval:@"JSON.stringify(window.firstScriptObservation)"
       world:[WKContentWorld pageWorld]
        then:^(id page, NSError *pageError) {
    if (pageError != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    NSString *source = @"JSON.stringify({preloadValue:globalThis.electronMbtPreloadValue === 42,"
      @"primordialIntact:Array.prototype.map === globalThis.electronMbtOriginalMap,"
      @"domShared:document.getElementById('shared-dom').textContent === 'shared DOM is not a privilege credential'})";
    [self eval:source world:self.world then:^(id isolated, NSError *isolatedError) {
      if (isolatedError != nil) { [weakSelf abort:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
      weakSelf.report[@"preconditions"] = @{@"page": page ?: [NSNull null], @"isolated": isolated ?: [NSNull null]};
      BOOL ok = [page[@"preloadHidden"] isEqual:@YES] && [page[@"handlerHidden"] isEqual:@YES] &&
        [isolated[@"preloadValue"] isEqual:@YES] && [isolated[@"primordialIntact"] isEqual:@YES] &&
        [isolated[@"domShared"] isEqual:@YES];
      if (!ok) { [weakSelf abort:@"ELECTRON_MBT_WORLD_ISOLATION_FAILED"]; return; }
      [weakSelf advance];
    }];
  }];
}

// Candidate 1: direct cross-world function reference. Worlds share the DOM but
// not JS objects, so this must be proven unreachable rather than assumed.
- (void)phaseCrossWorldReference {
  __weak SyncBridgeProbe *weakSelf = self;
  [self eval:@"globalThis.__isolatedFn = function () { return 'iso-rv'; }; 'ok'"
       world:self.world
        then:^(id value0, NSError *e0) {
    (void)value0;
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
    [self eval:@"globalThis.__pageFn = function () { return 'page-rv'; }; 'ok'"
         world:[WKContentWorld pageWorld]
          then:^(id value1, NSError *e1) {
      (void)value1;
      if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
      [self eval:@"JSON.stringify({isolatedFn: typeof globalThis.__isolatedFn})"
           world:[WKContentWorld pageWorld]
            then:^(id pageSees, NSError *e2) {
        if (e2 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
        [self eval:@"JSON.stringify({pageFn: typeof globalThis.__pageFn})"
             world:weakSelf.world
              then:^(id isolatedSees, NSError *e3) {
          if (e3 != nil) { [weakSelf abort:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
          [weakSelf candidate:@"crossWorldFunctionReference" body:@{
            @"executed": @YES,
            @"observed": @{@"isolatedFnVisibleFromPage": pageSees[@"isolatedFn"] ?: [NSNull null],
                           @"pageFnVisibleFromIsolated": isolatedSees[@"pageFn"] ?: [NSNull null]},
            @"synchronousChannel": @NO,
            @"contextBridgeCompatible": @NO,
            @"limitation": @"WKContentWorlds share DOM but not JS objects; a function defined in one "
                           @"world is 'undefined' in the other, so no direct synchronous reference exists.",
          }];
          [weakSelf advance];
        }];
      }];
    }];
  }];
}

// Candidate 2: shared-DOM synchronous dispatch. dispatchEvent is synchronous per
// DOM spec; an isolated-world listener can run during a page-world dispatch and
// write back through the shared DOM. If that round trip works it is still a
// string/primitive channel: no function identity, no thrown exceptions, all
// payloads page-observable.
- (void)phaseDomEventChannel {
  __weak SyncBridgeProbe *weakSelf = self;
  NSString *pageProbe = @"(function () {"
    @"var out = {};"
    @"var el = document.documentElement;"
    @"el.dataset.mbtRpcResult = '';"
    @"document.dispatchEvent(new CustomEvent('mbt-rpc', { detail: 'call-1' }));"
    @"out.resultAfterSyncDispatch = el.dataset.mbtRpcResult;"
    @"document.dispatchEvent(new CustomEvent('mbt-rpc', { detail: function () { return 1; } }));"
    @"document.dispatchEvent(new CustomEvent('mbt-rpc', { detail: { tag: 'obj-payload' } }));"
    @"var threw = false;"
    @"try { document.dispatchEvent(new CustomEvent('mbt-rpc', { detail: 'throw-now' })); }"
    @"catch (e) { threw = String(e); }"
    @"out.dispatcherCaughtThrow = threw;"
    @"return JSON.stringify(out);"
    @"})()";
  [self eval:pageProbe world:[WKContentWorld pageWorld] then:^(id page, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    [self eval:@"JSON.stringify(globalThis.__rpcCalls)" world:weakSelf.world then:^(id calls, NSError *e1) {
      if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
      BOOL syncRoundTrip = [page[@"resultAfterSyncDispatch"] isEqual:@"handled:call-1"];
      [weakSelf candidate:@"domEventDispatchChannel" body:@{
        @"executed": @YES,
        @"observed": @{
          @"isolatedListenerCalls": calls ?: [NSNull null],
          @"syncRoundTripViaSharedDom": @(syncRoundTrip),
          @"writeBack": page[@"resultAfterSyncDispatch"] ?: [NSNull null],
          @"dispatcherCaughtThrow": page[@"dispatcherCaughtThrow"] ?: [NSNull null],
        },
        @"synchronousChannel": @(syncRoundTrip),
        @"contextBridgeCompatible": @NO,
        @"limitation": @"A shared-DOM CustomEvent reaches the isolated listener synchronously and a "
                       @"dataset write-back completes the round trip, but detail payloads cross as "
                       @"primitives only, listener throws never reach the dispatcher, every value is "
                       @"page-readable shared DOM state, and any page script can invoke or observe it. "
                       @"It carries no function identity, so it is not a contextBridge proxy.",
      }];
      [weakSelf advance];
    }];
  }];
}

// Candidate 3: localStorage as a shared synchronous string store. Fulfills the
// same role as the dataset channel for file:// origins or fails loudly.
- (void)phaseLocalStorage {
  __weak SyncBridgeProbe *weakSelf = self;
  [self eval:@"try { localStorage.setItem('mbt-probe', 'page-write'); 'ok' } catch (e) { String(e) }"
       world:[WKContentWorld pageWorld]
        then:^(id write, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    [self eval:@"try { localStorage.getItem('mbt-probe') } catch (e) { String(e) }"
         world:weakSelf.world
          then:^(id read, NSError *e1) {
      if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
      [weakSelf candidate:@"sharedLocalStorage" body:@{
        @"executed": @YES,
        @"observed": @{@"pageWrite": write ?: [NSNull null], @"isolatedRead": read ?: [NSNull null]},
        @"synchronousChannel": @NO,
        @"contextBridgeCompatible": @NO,
        @"limitation": @"Where readable it is only a shared synchronous string store: no invocation, "
                       @"no function identity, and no exception channel. Notification across worlds "
                       @"still requires the DOM-event path.",
      }];
      [weakSelf advance];
    }];
  }];
}

// Candidate 4: the classic synchronous string channel — JS dialogs intercepted
// by WKUIDelegate. JS blocks until the completionHandler runs, so a string does
// cross synchronously, but the destination is the native delegate (not the
// isolated world), the payload is string-only, any page script can call it, and
// initiatedByFrame carries no world attribution.
- (void)phaseDialogs {
  __weak SyncBridgeProbe *weakSelf = self;
  // A second prompt attempt runs outside the evaluateJavaScript reply path so
  // a null cannot be blamed on eval-loop nesting.
  NSString *pageProbe = @"(function () {"
    @"var out = {};"
    @"out.promptTypeof = typeof window.prompt;"
    @"var t0 = performance.now();"
    @"out.promptResult = window.prompt('mbt-question', 'page-default');"
    @"out.promptBlockMs = Math.round(performance.now() - t0);"
    @"t0 = performance.now();"
    @"out.confirmResult = window.confirm('mbt-confirm');"
    @"out.confirmBlockMs = Math.round(performance.now() - t0);"
    @"out.alertResult = window.alert('mbt-alert');"
    @"globalThis.__latePrompt = 'pending';"
    @"setTimeout(function () { globalThis.__latePrompt = window.prompt('mbt-late', 'd'); }, 0);"
    @"return JSON.stringify(out);"
    @"})()";
  [self eval:pageProbe world:[WKContentWorld pageWorld] then:^(id page, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    [self afterMs:600 run:^{
      [self eval:@"JSON.stringify({latePrompt: globalThis.__latePrompt})"
             world:[WKContentWorld pageWorld]
              then:^(id late, NSError *e1) {
        if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
        BOOL promptDelivered = [page[@"promptResult"] isKindOfClass:[NSString class]] ||
                               [late[@"latePrompt"] isKindOfClass:[NSString class]];
        BOOL syncSignal = [page[@"confirmResult"] isEqual:@YES] || promptDelivered;
        [weakSelf candidate:@"jsDialogChannel" body:@{
          @"executed": @YES,
          @"observed": @{
            @"prompt": page[@"promptResult"] ?: [NSNull null],
            @"promptTypeof": page[@"promptTypeof"] ?: [NSNull null],
            @"promptBlockMs": page[@"promptBlockMs"] ?: [NSNull null],
            @"latePrompt": late[@"latePrompt"] ?: [NSNull null],
            @"confirm": page[@"confirmResult"] ?: [NSNull null],
            @"confirmBlockMs": page[@"confirmBlockMs"] ?: [NSNull null],
            @"alert": page[@"alertResult"] ?: [NSNull null],
            @"delegateCalls": [weakSelf.nativeLog filteredArrayUsingPredicate:
              [NSPredicate predicateWithFormat:@"kind BEGINSWITH 'dialog.'"]],
          },
          @"synchronousChannel": @(syncSignal),
          @"contextBridgeCompatible": @NO,
          @"limitation": @"confirm/alert reached the UIDelegate synchronously (boolean/void only), but "
                         @"window.prompt — the historical string channel — returned null without the "
                         @"text-panel delegate ever being invoked on this build. Where a dialog does "
                         @"fire, the channel ends at the native delegate, not at an isolated-world "
                         @"function; it is a page-visible surface any script can call, carries no world "
                         @"attribution on initiatedByFrame, and WebKit can suppress dialogs outright.",
        }];
        [weakSelf advance];
      }];
    }];
  }];
}

// Candidate 5: window.webkit.messageHandlers — the public world-scoped channel.
// Delivery is an async delegate callback; even the reply variant returns a
// Promise, so an immediate native reply still cannot be synchronous to JS.
- (void)phaseMessageHandlers {
  __weak SyncBridgeProbe *weakSelf = self;
  NSString *isolatedProbe = @"(function () {"
    @"var out = {};"
    @"var plain = window.webkit.messageHandlers.electronMbtProbe.postMessage({ n: 1 });"
    @"out.plainReturn = typeof plain;"
    @"out.plainIsPromise = plain instanceof Promise;"
    @"var reply = window.webkit.messageHandlers.electronMbtReply.postMessage('needs-reply');"
    @"out.replyReturn = typeof reply;"
    @"out.replyIsPromise = reply instanceof Promise;"
    @"globalThis.__replySettlement = 'unsettled';"
    @"if (reply instanceof Promise) {"
    @"  reply.then(function (v) { globalThis.__replySettlement = 'resolved:' + String(v); },"
    @"           function (e) { globalThis.__replySettlement = 'rejected:' + String(e); });"
    @"}"
    @"out.settledSynchronously = globalThis.__replySettlement !== 'unsettled';"
    @"return JSON.stringify(out);"
    @"})()";
  [self eval:isolatedProbe world:self.world then:^(id isolated, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
    // Let the Promise settle and the plain message reach the delegate, then
    // read the settlement marker: a resolved value proves the reply arrived
    // only on a later microtask/task, never inside the calling expression.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [weakSelf eval:@"JSON.stringify({settlement: globalThis.__replySettlement, "
        @"pageSeesHandlers: typeof window.webkit !== 'undefined' ? Object.keys(window.webkit.messageHandlers || {}) : []})"
               world:weakSelf.world
                then:^(id later, NSError *e1) {
        if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
        [weakSelf eval:@"typeof window.webkit === 'undefined' ? 'no-webkit' : "
          @"JSON.stringify({hasProbe: !!window.webkit.messageHandlers.electronMbtProbe})"
                 world:[WKContentWorld pageWorld]
                  then:^(id pageSide, NSError *e2) {
          if (e2 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
          [weakSelf candidate:@"scriptMessageHandlers" body:@{
            @"executed": @YES,
            @"observed": @{
              @"plainReturnType": isolated[@"plainReturn"] ?: [NSNull null],
              @"plainIsPromise": isolated[@"plainIsPromise"] ?: [NSNull null],
              @"replyReturnType": isolated[@"replyReturn"] ?: [NSNull null],
              @"replyIsPromise": isolated[@"replyIsPromise"] ?: [NSNull null],
              @"settledSynchronously": isolated[@"settledSynchronously"] ?: [NSNull null],
              @"settlementAfterTick": later[@"settlement"] ?: [NSNull null],
              @"pageWorldSeesIsolatedHandler": pageSide ?: [NSNull null],
              @"deliveries": [weakSelf.nativeLog filteredArrayUsingPredicate:
                [NSPredicate predicateWithFormat:@"kind BEGINSWITH 'scriptMessage.'"]],
            },
            @"synchronousChannel": @NO,
            @"contextBridgeCompatible": @NO,
            @"limitation": @"Delivery is an async delegate callback and even the WithReply variant "
                           @"hands JS a Promise: an immediately-invoked replyHandler still cannot "
                           @"return synchronously.",
          }];
          [weakSelf advance];
        }];
      }];
    });
  }];
}

// Candidate 6: synchronous XHR against a custom WKURLSchemeHandler. The JS side
// can block on send(), but the native side fulfills via async callbacks only —
// the API has no synchronous reply form.
- (void)phaseSchemeXhr {
  __weak SyncBridgeProbe *weakSelf = self;
  NSString *pageProbe = @"(function () {"
    @"var out = {};"
    @"try {"
    @"  var x = new XMLHttpRequest();"
    @"  var t0 = performance.now();"
    @"  x.open('GET', 'mbt://gate.invalid/sync', false);"
    @"  x.send();"
    @"  out.blockMs = Math.round(performance.now() - t0);"
    @"  out.status = x.status;"
    @"  out.response = x.responseText;"
    @"} catch (e) { out.error = e.name + ': ' + e.message; }"
    @"return JSON.stringify(out);"
    @"})()";
  [self eval:pageProbe world:[WKContentWorld pageWorld] then:^(id page, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    BOOL syncDelivery = [page[@"response"] isEqual:@"scheme-payload"];
    [weakSelf candidate:@"syncXhrToUrlSchemeHandler" body:@{
      @"executed": @YES,
      @"observed": @{
        @"xhr": page ?: [NSNull null],
        @"schemeTasks": [weakSelf.nativeLog filteredArrayUsingPredicate:
          [NSPredicate predicateWithFormat:@"kind BEGINSWITH 'scheme.'"]],
      },
      @"synchronousChannel": @(syncDelivery),
      @"contextBridgeCompatible": @NO,
      @"limitation": @"The only end-to-end synchronous channel found: sync XHR blocked JS and inline "
                     @"WKURLSchemeHandler fulfillment returned a string body. Still not a "
                     @"contextBridge proxy — the destination is a native URL task, not an "
                     @"isolated-world function; payloads are status/headers/body strings only; any "
                     @"page script can invoke it; CORS/opaque-origin rules apply; and Electron "
                     @"exposes no synchronous XHR semantics for preload bridges.",
    }];
    [weakSelf advance];
  }];
}

// Candidate 7: evaluateJavaScript from native — completionHandler by signature;
// record the async delivery as observed behavior.
- (void)phaseEvaluateAsync {
  __weak SyncBridgeProbe *weakSelf = self;
  __block BOOL markerRanFirst = NO;
  dispatch_async(dispatch_get_main_queue(), ^{ markerRanFirst = YES; });
  [self eval:@"1 + 1" world:[WKContentWorld pageWorld] then:^(id value, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    [weakSelf candidate:@"evaluateJavaScriptAsync" body:@{
      @"executed": @YES,
      @"observed": @{@"value": value ?: [NSNull null],
                     @"completionOnLaterRunLoopTurn": @(markerRanFirst)},
      @"synchronousChannel": @NO,
      @"contextBridgeCompatible": @NO,
      @"limitation": @"Every public evaluateJavaScript/callAsyncJavaScript variant is "
                     @"completionHandler-based; the host cannot synchronously read or call world "
                     @"code, and the web content process never sees a blocking call surface.",
    }];
    [weakSelf advance];
  }];
}

#pragma mark - WKUIDelegate (dialog channel)

- (void)webView:(WKWebView *)webView runJavaScriptAlertPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))completionHandler {
  (void)webView;
  [self recordNative:@"dialog.alert" detail:@{@"message": message,
    @"mainFrame": @(frame.isMainFrame), @"worldAttribution": @"none"}];
  completionHandler();
}

- (void)webView:(WKWebView *)webView runJavaScriptConfirmPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))completionHandler {
  (void)webView;
  [self recordNative:@"dialog.confirm" detail:@{@"message": message,
    @"mainFrame": @(frame.isMainFrame), @"worldAttribution": @"none"}];
  completionHandler(YES);
}

- (void)webView:(WKWebView *)webView runJavaScriptTextPanelWithMessage:(NSString *)message
    defaultText:(NSString *)defaultText initiatedByFrame:(WKFrameInfo *)frame
    completionHandler:(void (^)(NSString *))completionHandler {
  (void)webView;
  [self recordNative:@"dialog.prompt" detail:@{@"message": message, @"defaultText": defaultText,
    @"mainFrame": @(frame.isMainFrame), @"worldAttribution": @"none"}];
  completionHandler(@"native-string-reply");
}

#pragma mark - Script message handlers

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  (void)controller;
  [self recordNative:@"scriptMessage.plain" detail:@{@"name": message.name,
    @"body": [message.body isKindOfClass:[NSString class]] ? message.body : [message.body description],
    @"mainFrame": @(message.frameInfo.isMainFrame)}];
}

- (void)userContentController:(WKUserContentController *)controller
     didReceiveScriptMessage:(WKScriptMessage *)message
                replyHandler:(void (^)(id, NSString *))replyHandler {
  (void)controller;
  [self recordNative:@"scriptMessage.withReply" detail:@{@"name": message.name,
    @"body": [message.body description], @"mainFrame": @(message.frameInfo.isMainFrame)}];
  replyHandler(@"native-reply-value", nil);
}

#pragma mark - WKURLSchemeHandler

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
  (void)webView;
  [self recordNative:@"scheme.start" detail:@{@"url": urlSchemeTask.request.URL.absoluteString,
    @"apiStyle": @"async-callback-only"}];
  NSString *body = @"scheme-payload";
  NSDictionary *headers = @{@"Access-Control-Allow-Origin": @"*", @"Content-Type": @"text/plain"};
  NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:urlSchemeTask.request.URL
    statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:headers];
  // Inline fulfillment is legal public API: the callbacks run inside the
  // delegate call, so a blocked sync XHR unblocks with a real response. That
  // is an end-to-end synchronous string channel — still not a function proxy.
  [self recordNative:@"scheme.fulfillInline" detail:@{@"url": urlSchemeTask.request.URL.absoluteString}];
  [urlSchemeTask didReceiveResponse:response];
  [urlSchemeTask didReceiveData:[body dataUsingEncoding:NSUTF8StringEncoding]];
  [urlSchemeTask didFinish];
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
  (void)webView;
  [self recordNative:@"scheme.stop" detail:@{@"url": urlSchemeTask.request.URL.absoluteString}];
}

#pragma mark - Navigation

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action
    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  BOOL allowed = action.targetFrame.isMainFrame && [action.request.URL isEqual:self.fixture];
  decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
  if (!allowed) [self abort:@"ELECTRON_MBT_PROBE_NAVIGATION_DENIED"];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)webView; (void)navigation;
  [self advance];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  (void)webView; (void)navigation; (void)error;
  [self abort:@"ELECTRON_MBT_PROBE_LOAD_FAILED"];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  (void)webView; (void)navigation; (void)error;
  [self abort:@"ELECTRON_MBT_PROBE_LOAD_FAILED"];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  (void)webView;
  [self abort:@"ELECTRON_MBT_WEB_CONTENT_TERMINATED"];
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) { finish(@{@"status": @"FAIL", @"code": @"ELECTRON_MBT_PROBE_USAGE"}, 1); }
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    SyncBridgeProbe *probe = [[SyncBridgeProbe alloc] init];
    probe.fixture = [NSURL fileURLWithPath:[[NSString stringWithUTF8String:argv[1]] stringByResolvingSymlinksInPath]];
    [probe start];
    [NSApp run];
  }
  return 1;
}
