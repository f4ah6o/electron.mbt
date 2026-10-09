#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static void finish(NSDictionary *result, int code) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
  if (data != nil) { fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout); }
  exit(code);
}

@interface WorldProbe : NSObject <WKNavigationDelegate, WKScriptMessageHandler>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKContentWorld *world;
@property(nonatomic, copy) NSURL *fixture;
@property(nonatomic) BOOL sawMainFrame;
@end

@implementation WorldProbe
- (void)fail:(NSString *)reason {
  finish(@{@"probe": @"wkcontentworld", @"status": @"FAIL", @"code": reason,
           @"contextBridge": @"NOT_IMPLEMENTED", @"compatibilityGate": @"OPEN"}, 1);
}
- (void)start {
  self.world = [WKContentWorld worldWithName:@"electron.mbt.feasibility.preload"];
  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  WKUserContentController *content = configuration.userContentController;
  [content addScriptMessageHandler:self contentWorld:self.world name:@"electronMbtProbe"];
  NSString *preload = @"globalThis.electronMbtPreloadValue = 42;"
    @"globalThis.electronMbtOriginalMap = Array.prototype.map;"
    @"window.webkit.messageHandlers.electronMbtProbe.postMessage('started');";
  WKUserScript *script = [[WKUserScript alloc] initWithSource:preload
    injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES inContentWorld:self.world];
  [content addUserScript:script];
  self.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 640, 480) configuration:configuration];
  self.webView.navigationDelegate = self;
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 640, 480)
    styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  self.window.releasedWhenClosed = NO;
  self.window.contentView = self.webView;
  self.window.title = @"electron.mbt world feasibility probe";
  [self.window orderFront:nil];
  [self.webView loadFileURL:self.fixture allowingReadAccessToURL:self.fixture.URLByDeletingLastPathComponent];
  __weak WorldProbe *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [weakSelf fail:@"ELECTRON_MBT_PROBE_TIMEOUT"];
  });
}
- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message {
  (void)controller;
  if (message.webView != self.webView || !message.frameInfo.isMainFrame ||
      ![message.name isEqualToString:@"electronMbtProbe"] || ![message.body isEqual:@"started"]) {
    [self fail:@"ELECTRON_MBT_UNEXPECTED_PROBE_SENDER"];
    return;
  }
  self.sawMainFrame = YES;
}
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  // Broad file-directory access is not evidence that navigation is authorized.
  BOOL allowed = action.targetFrame.isMainFrame && [action.request.URL isEqual:self.fixture];
  decisionHandler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
  if (!allowed) [self fail:@"ELECTRON_MBT_PROBE_NAVIGATION_DENIED"];
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  (void)navigation;
  __weak WorldProbe *weakSelf = self;
  [webView evaluateJavaScript:@"JSON.stringify(window.firstScriptObservation)" inFrame:nil
    inContentWorld:[WKContentWorld pageWorld] completionHandler:^(id pageResult, NSError *pageError) {
      WorldProbe *probe = weakSelf;
      if (pageError != nil || ![pageResult isKindOfClass:[NSString class]]) { [probe fail:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
      NSDictionary *page = [NSJSONSerialization JSONObjectWithData:[pageResult dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
      NSString *source = @"JSON.stringify({preloadValue:globalThis.electronMbtPreloadValue === 42,"
        @"primordialIntact:Array.prototype.map === globalThis.electronMbtOriginalMap,"
        @"domShared:document.getElementById('shared-dom').textContent === 'shared DOM is not a privilege credential'})";
      [probe.webView evaluateJavaScript:source inFrame:nil inContentWorld:probe.world completionHandler:^(id isolatedResult, NSError *isolatedError) {
        if (isolatedError != nil || ![isolatedResult isKindOfClass:[NSString class]]) { [probe fail:@"ELECTRON_MBT_ISOLATED_OBSERVATION"]; return; }
        NSDictionary *isolated = [NSJSONSerialization JSONObjectWithData:[isolatedResult dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
        BOOL passed = [page[@"preloadHidden"] isEqual:@YES] && [page[@"handlerHidden"] isEqual:@YES] &&
          [isolated[@"preloadValue"] isEqual:@YES] && [isolated[@"primordialIntact"] isEqual:@YES] &&
          [isolated[@"domShared"] isEqual:@YES] && probe.sawMainFrame;
        if (!passed) { [probe fail:@"ELECTRON_MBT_WORLD_ISOLATION_FAILED"]; return; }
        NSDictionary *result = @{@"probe": @"wkcontentworld", @"status": @"PASS",
          @"page": page, @"isolated": isolated, @"hostObservedMainFrame": @YES,
          @"contextBridge": @"NOT_IMPLEMENTED", @"compatibilityGate": @"OPEN",
          @"environment": @{@"os": NSProcessInfo.processInfo.operatingSystemVersionString,
            @"webkit": [[NSBundle bundleForClass:[WKWebView class]] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown"}};
        [probe.webView.configuration.userContentController removeScriptMessageHandlerForName:@"electronMbtProbe" contentWorld:probe.world];
        [probe.webView.configuration.userContentController removeAllUserScripts];
        probe.webView.navigationDelegate = nil;
        [probe.webView stopLoading];
        [probe.window close];
        finish(result, 0);
      }];
  }];
}
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  (void)webView; (void)navigation; (void)error;
  [self fail:@"ELECTRON_MBT_PROBE_LOAD_FAILED"];
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
  (void)webView; (void)navigation; (void)error;
  [self fail:@"ELECTRON_MBT_PROBE_LOAD_FAILED"];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  (void)webView;
  [self fail:@"ELECTRON_MBT_WEB_CONTENT_TERMINATED"];
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) { finish(@{@"status": @"FAIL", @"code": @"ELECTRON_MBT_PROBE_USAGE"}, 1); }
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    WorldProbe *probe = [[WorldProbe alloc] init];
    probe.fixture = [NSURL fileURLWithPath:[[NSString stringWithUTF8String:argv[1]] stringByResolvingSymlinksInPath]];
    [probe start];
    [NSApp run];
  }
  return 1;
}
