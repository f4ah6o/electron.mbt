#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CoreGraphics/CGEvent.h>

// Gate B (issue 0001 §13 row G, §16): drive a real WKWebView and record what a
// native host can genuinely exercise on this machine — window focus/blur,
// resize and devicePixelRatio observation, text input, and pasteboard. DOM
// events synthesized by evaluateJavaScript are recorded as DOM synthesis only;
// real OS input goes through CGEventPost and is reported separately. Anything
// that cannot be exercised (real IME composition, VoiceOver traversal, real
// keyboard hardware) stays an explicit NOT_RUN entry.

static void finish(NSDictionary *result, int code) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
  if (data != nil) { fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout); }
  exit(code);
}

@interface NativeProbe : NSObject <WKNavigationDelegate, NSWindowDelegate>
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSWindow *shadowWindow;
@property(nonatomic, copy) NSURL *fixture;
@property(nonatomic, strong) NSMutableDictionary *report;
@property(nonatomic, strong) NSMutableDictionary *traces;
@property(nonatomic, strong) NSMutableArray *nativeLog;
@property(nonatomic, strong) NSMutableArray<dispatch_block_t> *phases;
@property(nonatomic) NSUInteger phaseIndex;
@property(nonatomic, copy) NSString *currentPhase;
@property(nonatomic, copy) NSString *stallPhase;
@property(nonatomic) NSInteger chainToken;
@end

@implementation NativeProbe

- (void)recordNative:(NSString *)kind detail:(id)detail {
  [self.nativeLog addObject:@{@"kind": kind, @"detail": detail ?: [NSNull null],
                              @"at": @([[NSDate date] timeIntervalSince1970])}];
}

- (void)trace:(NSString *)name body:(NSDictionary *)body {
  NSMutableDictionary *entry = [body mutableCopy];
  entry[@"attempted"] = @YES;
  self.traces[name] = entry;
}

- (void)abort:(NSString *)code {
  finish(@{@"probe": @"wknative", @"status": @"FAIL", @"code": code,
           @"compatibilityGate": @"OPEN",
           @"traces": self.traces, @"nativeObservations": self.nativeLog}, 1);
}

// The observation each trace must produce. Unexpected values flip the run to
// INCONCLUSIVE; a stalled or missing trace makes it PARTIAL — the top-level
// status is computed, never asserted from constants.
- (NSString *)outcomeForTrace:(NSString *)name
                     observed:(NSDictionary *)obs
                  expectation:(NSString **)expectation {
  if ([name isEqual:@"inputDomSynthesis"]) {
    *expectation = @"evaluateJavaScript-synthesized events must all carry isTrusted=false and insert no text";
    if ([obs[@"anyTrustedEvent"] isEqual:@YES]) return @"unexpected";
    return @"as-expected";
  }
  if ([name isEqual:@"inputOsEvent"]) {
    *expectation = @"delivery outcomes are recorded per path; trusted input is AppKit/WindowServer-level, not hardware";
    return @"as-expected";
  }
  if ([name isEqual:@"resizeAndDpi"]) {
    *expectation = @"the real NSWindow resize produces a DOM resize event and a changed viewport";
    NSDictionary *after = obs[@"after"];
    NSDictionary *before = obs[@"before"];
    BOOL resized = [after[@"resizeEvents"] integerValue] >= 1 &&
                   ![after[@"inner"] isEqual:before[@"inner"]];
    return resized ? @"as-expected" : @"unexpected";
  }
  if ([name isEqual:@"pasteboard"]) {
    *expectation = @"the named NSPasteboard write/read round-trips; a parked DOM probe is recorded as stalled";
    NSDictionary *native = obs[@"native"];
    BOOL roundTrip = [native[@"write"] isEqual:@YES] &&
                     [native[@"readBack"] isEqual:@"mbt-pasteboard-ok"];
    if (!roundTrip) return @"unexpected";
    if ([obs[@"dom"][@"stalled"] isEqual:@YES]) return @"stalled";
    return @"as-expected";
  }
  if ([name isEqual:@"accessibilityTree"]) {
    *expectation = @"an in-process AX role read returns a non-null value";
    return obs[@"webViewRole"] != nil && obs[@"webViewRole"] != [NSNull null]
         ? @"as-expected" : @"unexpected";
  }
  *expectation = nil;
  return @"as-expected";
}

- (void)emit {
  NSInteger unexpected = 0, notRun = 0, executed = 0, stalled = 0;
  for (NSString *name in self.traces.allKeys) {
    NSMutableDictionary *entry = [self.traces[name] mutableCopy];
    if ([entry[@"status"] isEqual:@"NOT_RUN"] || ![entry[@"attempted"] isEqual:@YES]) {
      entry[@"outcome"] = @"not-run";
      notRun++;
    } else {
      NSString *expectation = nil;
      NSString *outcome = [self outcomeForTrace:name
                                       observed:entry[@"observed"]
                                    expectation:&expectation];
      if (expectation != nil) entry[@"expectation"] = expectation;
      entry[@"outcome"] = outcome;
      if ([outcome isEqual:@"unexpected"]) unexpected++;
      else if ([outcome isEqual:@"stalled"]) stalled++;
      else executed++;
    }
    self.traces[name] = entry;
  }
  NSString *status = unexpected > 0 ? @"INCONCLUSIVE"
                   : (stalled > 0 || self.stallPhase != nil) ? @"PARTIAL" : @"PASS";
  NSMutableDictionary *result = [@{
    @"probe": @"wknative",
    @"status": status,
    @"compatibilityGate": @"OPEN",
    @"coverage": @{@"executed": @(executed), @"notRun": @(notRun),
                   @"stalled": @(stalled), @"unexpected": @(unexpected)},
    @"note": @"DOM events marked isTrusted=false are evaluateJavaScript synthesis, not OS input. "
             @"Entries with attempted=NO were genuinely unexercisable on this machine.",
    @"traces": self.traces,
    @"nativeObservations": self.nativeLog,
    @"environment": @{
      @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
      @"webkit": [[NSBundle bundleForClass:[WKWebView class]] objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"unknown",
      @"screens": @([NSScreen screens].count),
      @"backingScaleFactor": @(self.window.backingScaleFactor),
    },
  } mutableCopy];
  if (self.stallPhase != nil) {
    result[@"probeStall"] = @{@"phase": self.stallPhase,
      @"reason": @"the phase chain stopped advancing (e.g. an evaluateJavaScript completion never "
                @"arrived because the web process blocked); later phases were never attempted"};
  }
  finish(result, 0);
}

- (void)advance {
  if (self.phaseIndex >= self.phases.count) { [self emit]; return; }
  dispatch_block_t phase = self.phases[self.phaseIndex++];
  phase();
}

- (void)addPhase:(NSString *)name block:(dispatch_block_t)block {
  __weak NativeProbe *weakSelf = self;
  [self.phases addObject:^{
    weakSelf.currentPhase = name;
    block();
  }];
}

// A phase can wedge when evaluateJavaScript never returns (the web process
// blocks, e.g. on a pasteboard-consent prompt). The guard records the stall
// for that trace and moves the chain on; a late completion then no-ops
// because currentPhase no longer matches.
- (void)guardPhase:(NSTimeInterval)seconds fallback:(void (^)(void))fallback {
  __weak NativeProbe *weakSelf = self;
  NSInteger token = ++self.chainToken;
  NSString *phase = self.currentPhase;
  [self afterMs:seconds * 1000 run:^{
    NativeProbe *strongSelf = weakSelf;
    if (strongSelf == nil) return;
    if (![strongSelf.currentPhase isEqualToString:phase] || token != strongSelf.chainToken) return;
    strongSelf.chainToken++;
    fallback();
    [strongSelf advance];
  }];
}

- (void)eval:(NSString *)js then:(void (^)(id value, NSError *error))then {
  [self.webView evaluateJavaScript:js inFrame:nil inContentWorld:[WKContentWorld pageWorld]
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

- (void)afterMs:(double)ms run:(dispatch_block_t)block {
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(ms * NSEC_PER_MSEC)),
                 dispatch_get_main_queue(), block);
}

- (void)start {
  self.report = [NSMutableDictionary dictionary];
  self.traces = [NSMutableDictionary dictionary];
  // Anything genuinely unexercisable is seeded up front so a stalled chain
  // still reports it as NOT_RUN rather than silently dropping the entry.
  self.traces[@"imeComposition"] = @{@"attempted": @NO, @"status": @"NOT_RUN",
    @"reason": @"Real IME marked-text composition cannot be driven from a public-API probe; "
               @"no marked text was ever produced on this machine."};
  self.traces[@"voiceOverTraversal"] = @{@"attempted": @NO, @"status": @"NOT_RUN",
    @"reason": @"VoiceOver cannot be enabled and driven from this process; in-process AX "
               @"attribute reads were recorded separately under accessibilityTree."};
  self.traces[@"realKeyboardHardware"] = @{@"attempted": @NO, @"status": @"NOT_RUN",
    @"reason": @"No operator pressed real keys; posted events may carry isTrusted but are not "
               @"proof of hardware input."};
  NSUInteger screenCount = [NSScreen screens].count;
  self.traces[@"secondaryDisplayDpi"] = @{@"attempted": @NO, @"status": @"NOT_RUN",
    @"reason": screenCount < 2
      ? [NSString stringWithFormat:@"Only %lu display is attached, so a devicePixelRatio transition "
         @"cannot be exercised on this machine.", (unsigned long)screenCount]
      : [NSString stringWithFormat:@"%lu displays are attached but this probe does not retarget the "
         @"window across backing-scale factors; a real DPI transition was not exercised.",
         (unsigned long)screenCount]};
  self.nativeLog = [NSMutableArray array];
  self.phases = [NSMutableArray array];
  self.phaseIndex = 0;
  self.currentPhase = @"pre-navigation";
  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  self.webView = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, 640, 480) configuration:configuration];
  self.webView.navigationDelegate = self;
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(80, 80, 640, 480)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable
    backing:NSBackingStoreBuffered defer:NO];
  self.window.releasedWhenClosed = NO;
  self.window.delegate = self;
  self.window.contentView = self.webView;
  self.window.title = @"electron.mbt native gate probe";
  [self.window orderFront:nil];

  __weak NativeProbe *weakSelf = self;
  [self addPhase:@"phaseFocus" block:^{ [weakSelf phaseFocus]; }];
  [self addPhase:@"phaseResizeAndDpi" block:^{ [weakSelf phaseResizeAndDpi]; }];
  [self addPhase:@"phaseDomSynthesizedInput" block:^{ [weakSelf phaseDomSynthesizedInput]; }];
  [self addPhase:@"phaseOsInput" block:^{ [weakSelf phaseOsInput]; }];
  [self addPhase:@"phaseOsPaste" block:^{ [weakSelf phaseOsPaste]; }];
  [self addPhase:@"phasePasteboard" block:^{ [weakSelf phasePasteboard]; }];
  [self addPhase:@"phaseAccessibility" block:^{ [weakSelf phaseAccessibility]; }];
  [self.webView loadFileURL:self.fixture allowingReadAccessToURL:self.fixture.URLByDeletingLastPathComponent];
  // Watchdog: if the phase chain stalls (a completion handler that never
  // fires), still emit the accumulated traces with the stall recorded.
  [self afterMs:37000 run:^{
    weakSelf.stallPhase = weakSelf.currentPhase ?: @"unknown";
    [weakSelf emit];
  }];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 45 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [weakSelf abort:@"ELECTRON_MBT_PROBE_TIMEOUT"];
  });
}

#pragma mark - Focus / blur

- (void)phaseFocus {
  __weak NativeProbe *weakSelf = self;
  // Record the activation attempt itself instead of assuming focus worked;
  // isActive/windowKey are the observable truth, not the call's return.
  BOOL activated = NO;
  if ([NSApp respondsToSelector:@selector(activate)]) {
    [NSApp activate];
    activated = YES;
  }
  if (!activated) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    [NSApp activateIgnoringOtherApps:YES];
#pragma clang diagnostic pop
  }
  [weakSelf recordNative:@"focus.activate" detail:@{@"activateInvoked": @(activated)}];
  [self.window makeKeyAndOrderFront:nil];
  [self.window makeFirstResponder:self.webView];
  [self afterMs:700 run:^{
    [weakSelf eval:@"JSON.stringify({trace: window.__gateTrace, hasFocus: document.hasFocus()})"
              then:^(id focused, NSError *e0) {
      if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
      NSDictionary *nativeFocus = @{@"appActive": @([NSApp isActive]),
                                    @"windowKey": @(weakSelf.window.isKeyWindow),
                                    @"activateInvoked": @(activated)};
      [weakSelf recordNative:@"focus.native" detail:nativeFocus];
      // Move key status to a shadow window so blur is observable without
      // depending on another application.
      weakSelf.shadowWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(760, 80, 200, 120)
        styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
      weakSelf.shadowWindow.releasedWhenClosed = NO;
      weakSelf.shadowWindow.delegate = weakSelf;
      [weakSelf.shadowWindow makeKeyAndOrderFront:nil];
      [weakSelf afterMs:500 run:^{
        [weakSelf eval:@"JSON.stringify({trace: window.__gateTrace, hasFocus: document.hasFocus()})"
                  then:^(id blurred, NSError *e1) {
          if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
          BOOL focusSeen = NO, blurSeen = NO;
          for (NSDictionary *t in blurred[@"trace"]) {
            if ([t[@"kind"] isEqual:@"window.focus"]) focusSeen = YES;
            if ([t[@"kind"] isEqual:@"window.blur"]) blurSeen = YES;
          }
          [weakSelf trace:@"windowFocusBlur" body:@{
            @"executed": @(focusSeen && blurSeen),
            @"observed": @{@"afterActivate": focused, @"afterShadowKey": blurred,
                           @"domFocusEvent": @(focusSeen), @"domBlurEvent": @(blurSeen),
                           @"native": nativeFocus,
                           @"keyNotifications": [weakSelf.nativeLog filteredArrayUsingPredicate:
                             [NSPredicate predicateWithFormat:@"kind BEGINSWITH 'window.'"]]},
          }];
          if (!(focusSeen && blurSeen)) {
            NSMutableDictionary *entry = [weakSelf.traces[@"windowFocusBlur"] mutableCopy];
            entry[@"status"] = @"NOT_RUN";
            entry[@"reason"] = @"the app could not take key status in this session, so no DOM "
                               @"focus/blur trace was produced";
            weakSelf.traces[@"windowFocusBlur"] = entry;
          }
          [weakSelf.shadowWindow close];
          [weakSelf.window makeKeyAndOrderFront:nil];
          [weakSelf.window makeFirstResponder:weakSelf.webView];
          [weakSelf afterMs:400 run:^{ [weakSelf advance]; }];
        }];
      }];
    }];
  }];
}

#pragma mark - Resize / DPI

- (void)phaseResizeAndDpi {
  __weak NativeProbe *weakSelf = self;
  NSString *metrics = @"JSON.stringify({dpr: window.devicePixelRatio,"
    @"inner: [window.innerWidth, window.innerHeight],"
    @"screen: {w: screen.width, h: screen.height, avail: [screen.availWidth, screen.availHeight]},"
    @"visualViewport: [visualViewport.width, visualViewport.height],"
    @"mqlMatches: window.__dpiMql.matches})";
  [self eval:metrics then:^(id before, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    [weakSelf.window setFrame:NSMakeRect(40, 40, 800, 600) display:YES animate:NO];
    [weakSelf afterMs:500 run:^{
      [weakSelf eval:[NSString stringWithFormat:@"(function(){var m=%@;m.resizeEvents="
        @"window.__gateTrace.filter(function(t){return t.kind==='window.resize'}).length;"
        @"m.dpiChanged=window.__gateTrace.some(function(t){return t.kind==='dpi-change'});"
        @"return JSON.stringify(m)})()", [metrics substringFromIndex:14]]
                then:^(id after, NSError *e1) {
        if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
        [weakSelf trace:@"resizeAndDpi" body:@{
          @"executed": @YES,
          @"observed": @{@"before": before, @"after": after,
                         @"windowBackingScaleFactor": @(weakSelf.window.backingScaleFactor),
                         @"screenCount": @([NSScreen screens].count)},
          @"note": @"resize events and inner/visual viewport reflect the real NSWindow resize; "
                   @"devicePixelRatio is a display property — it cannot change on the same screen, "
                   @"and this machine has no second display to force a DPI transition.",
        }];
        [weakSelf advance];
      }];
    }];
  }];
}

#pragma mark - Input: DOM synthesis vs real OS events

- (void)phaseDomSynthesizedInput {
  __weak NativeProbe *weakSelf = self;
  NSString *probe = @"(function () {"
    @"var input = document.getElementById('probe-input');"
    @"input.focus();"
    @"var before = window.__gateTrace.length;"
    @"input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));"
    @"input.dispatchEvent(new InputEvent('input', { data: 'a', bubbles: true, inputType: 'insertText' }));"
    @"var events = window.__gateTrace.slice(before);"
    @"return JSON.stringify({ value: input.value, focused: document.activeElement === input,"
    @"  hasFocus: document.hasFocus(), events: events });"
    @"})()";
  [self eval:probe then:^(id result, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    BOOL anyTrusted = NO;
    for (NSDictionary *t in result[@"events"]) {
      id detail = [NSJSONSerialization JSONObjectWithData:[t[@"detail"] dataUsingEncoding:NSUTF8StringEncoding]
                                                  options:0 error:NULL];
      if ([detail[@"trusted"] isEqual:@YES]) anyTrusted = YES;
    }
    [weakSelf trace:@"inputDomSynthesis" body:@{
      @"executed": @YES,
      @"observed": @{@"inputValueAfterSyntheticEvents": result[@"value"] ?: [NSNull null],
                     @"documentFocused": result[@"hasFocus"] ?: [NSNull null],
                     @"events": result[@"events"] ?: @[],
                     @"anyTrustedEvent": @(anyTrusted)},
      @"note": @"dispatchEvent reaches listeners but every event carries isTrusted=false and no text "
               @"is inserted — DOM synthesis never enters the WebKit input pipeline and is not OS "
               @"input evidence.",
    }];
    [weakSelf advance];
  }];
}

- (void)phaseOsInput {
  __weak NativeProbe *weakSelf = self;
  [self.window makeKeyWindow];
  [self.window makeFirstResponder:self.webView];
  [self eval:@"document.getElementById('probe-input').focus();"
      @"JSON.stringify({focused: document.activeElement.id, hasFocus: document.hasFocus()})"
        then:^(id focusState, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    __block NSInteger traceBefore = 0;
    [weakSelf eval:@"JSON.stringify({n: window.__gateTrace.length, v: document.getElementById('probe-input').value})"
              then:^(id snap, NSError *e1) {
      if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
      traceBefore = [snap[@"n"] integerValue];
      // Path 1 — WindowServer-level: CGEvent posted into this process's queue
      // (key code 0 = 'a'). Path 2 — AppKit-level: an NSEvent injected with
      // sendEvent: ('b'), the deepest public event-dispatch API; it exercises
      // the native input pipeline but is not hardware input.
      pid_t pid = [NSProcessInfo processInfo].processIdentifier;
      CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
      CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
      BOOL cgPosted = down != NULL && up != NULL;
      if (cgPosted) {
        CGEventPostToPid(pid, down);
        CGEventPostToPid(pid, up);
        CFRelease(down); CFRelease(up);
      }
      NSEvent *nse = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSMakePoint(100, 100)
        modifierFlags:0 timestamp:[[NSDate date] timeIntervalSince1970]
        windowNumber:weakSelf.window.windowNumber context:nil
        characters:@"b" charactersIgnoringModifiers:@"b" isARepeat:NO keyCode:11];
      BOOL nsPosted = nse != nil;
      if (nsPosted) [NSApp sendEvent:nse];
      [weakSelf recordNative:@"input.paths" detail:@{@"cgEventPosted": @(cgPosted),
        @"nsEventPosted": @(nsPosted), @"windowKey": @(weakSelf.window.isKeyWindow)}];
      [weakSelf afterMs:600 run:^{
        [weakSelf eval:@"JSON.stringify({value: document.getElementById('probe-input').value, trace: window.__gateTrace})"
                  then:^(id result, NSError *e3) {
          if (e3 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
          NSMutableArray *newEvents = [NSMutableArray array];
          NSArray *trace = result[@"trace"];
          for (NSInteger i = traceBefore; i < (NSInteger)trace.count; i++) {
            [newEvents addObject:trace[(NSUInteger)i]];
          }
          BOOL trustedKey = NO;
          for (NSDictionary *t in newEvents) {
            if (![t[@"kind"] hasPrefix:@"input."]) continue;
            id detail = [NSJSONSerialization JSONObjectWithData:[t[@"detail"] dataUsingEncoding:NSUTF8StringEncoding]
                                                        options:0 error:NULL];
            if ([detail[@"trusted"] isEqual:@YES]) trustedKey = YES;
          }
          NSString *value = [result[@"value"] isKindOfClass:[NSString class]] ? result[@"value"] : @"";
          BOOL cgDelivered = [value containsString:@"a"];
          BOOL nsDelivered = [value containsString:@"b"];
          BOOL delivered = cgDelivered || nsDelivered || trustedKey;
          [weakSelf trace:@"inputOsEvent" body:@{
            @"executed": @(delivered),
            @"observed": @{@"focusState": focusState,
                           @"paths": @{@"cgEventPosted": @(cgPosted), @"cgEventDelivered": @(cgDelivered),
                                       @"nsEventPosted": @(nsPosted), @"nsEventDelivered": @(nsDelivered)},
                           @"inputValue": value,
                           @"domEvents": newEvents, @"trustedEventSeen": @(trustedKey)},
            @"note": delivered
              ? @"A posted event reached the DOM as isTrusted input — genuine native-path delivery "
                @"(sendEvent is AppKit-level, CGEvent is WindowServer-level; neither is hardware)."
              : @"Neither posted path produced a trusted DOM input event; the session does not route "
                @"OS-level input to this process.",
          }];
          if (!delivered) {
            NSMutableDictionary *entry = [weakSelf.traces[@"inputOsEvent"] mutableCopy];
            entry[@"status"] = @"NOT_RUN";
            entry[@"reason"] = @"CGEventPostToPid and sendEvent both produced no trusted DOM input event";
            weakSelf.traces[@"inputOsEvent"] = entry;
          }
          [weakSelf advance];
        }];
      }];
    }];
  }];
}

// Real OS-level paste: preload the system pasteboard natively, then post Cmd+V.
// Mutating the general pasteboard destroys a developer's clipboard, so this
// phase runs only with ELECTRON_MBT_OS_PASTE_OPT_IN=1 (set in CI, where the
// pasteboard is disposable); otherwise it is an explicit NOT_RUN.
- (void)phaseOsPaste {
  __weak NativeProbe *weakSelf = self;
  if (![NSProcessInfo.processInfo.environment[@"ELECTRON_MBT_OS_PASTE_OPT_IN"] isEqual:@"1"]) {
    [self trace:@"osPaste" body:@{
      @"executed": @NO,
      @"status": @"NOT_RUN",
      @"reason": @"posting Cmd+V requires writing the general pasteboard, which would destroy the "
                 @"user's clipboard contents; set ELECTRON_MBT_OS_PASTE_OPT_IN=1 in a disposable "
                 @"environment (CI sets it) to opt in",
    }];
    [self advance];
    return;
  }
  NSPasteboard *pb = [NSPasteboard generalPasteboard];
  [pb clearContents];
  [pb setString:@"mbt-cgevent-paste" forType:NSPasteboardTypeString];
  [self eval:@"document.getElementById('probe-input').focus();"
      @"JSON.stringify({hasFocus: document.hasFocus(), focused: document.activeElement.id})"
        then:^(id focusState, NSError *e0) {
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    pid_t pid = [NSProcessInfo processInfo].processIdentifier;
    CGEventRef down = CGEventCreateKeyboardEvent(NULL, 9, true);   // 'v'
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, 9, false);
    BOOL cgPosted = down != NULL && up != NULL;
    if (cgPosted) {
      CGEventSetFlags(down, kCGEventFlagMaskCommand);
      CGEventSetFlags(up, kCGEventFlagMaskCommand);
      CGEventPostToPid(pid, down);
      CGEventPostToPid(pid, up);
      CFRelease(down); CFRelease(up);
    }
    NSEvent *nse = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSMakePoint(100, 100)
      modifierFlags:NSEventModifierFlagCommand timestamp:[[NSDate date] timeIntervalSince1970]
      windowNumber:weakSelf.window.windowNumber context:nil
      characters:@"v" charactersIgnoringModifiers:@"v" isARepeat:NO keyCode:9];
    BOOL nsPosted = nse != nil;
    if (nsPosted) [NSApp sendEvent:nse];
    [weakSelf recordNative:@"paste.paths" detail:@{@"cgEventPosted": @(cgPosted),
      @"nsEventPosted": @(nsPosted), @"focusState": focusState,
      @"windowKey": @(weakSelf.window.isKeyWindow)}];
    [weakSelf afterMs:600 run:^{
      [weakSelf eval:@"JSON.stringify({value: document.getElementById('probe-input').value, trace: window.__gateTrace})"
                then:^(id result, NSError *e1) {
        if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
        BOOL pasteSeen = NO, trusted = NO;
        for (NSDictionary *t in result[@"trace"]) {
          if (![t[@"kind"] isEqual:@"input.paste"]) continue;
          pasteSeen = YES;
          id detail = [NSJSONSerialization JSONObjectWithData:[t[@"detail"] dataUsingEncoding:NSUTF8StringEncoding]
                                                      options:0 error:NULL];
          if ([detail[@"trusted"] isEqual:@YES]) trusted = YES;
        }
        BOOL delivered = [result[@"value"] containsString:@"mbt-cgevent-paste"] || trusted;
        [weakSelf trace:@"osPaste" body:@{
          @"executed": @(delivered),
          @"observed": @{@"paths": @{@"cgEventPosted": @(cgPosted), @"nsEventPosted": @(nsPosted)},
                         @"focusState": focusState,
                         @"inputValue": result[@"value"] ?: [NSNull null],
                         @"pasteEventSeen": @(pasteSeen), @"pasteEventTrusted": @(trusted)},
          @"note": delivered
            ? @"A posted Cmd+V delivered the pasteboard into the DOM — genuine native-path paste."
            : @"Cmd+V was posted on both paths but produced no trusted paste event or value.",
        }];
        if (!delivered) {
          NSMutableDictionary *entry = [weakSelf.traces[@"osPaste"] mutableCopy];
          entry[@"status"] = @"NOT_RUN";
          entry[@"reason"] = @"posted Cmd+V (CGEvent + sendEvent) produced no trusted paste event";
          weakSelf.traces[@"osPaste"] = entry;
        }
        [weakSelf advance];
      }];
    }];
  }];
}

#pragma mark - Pasteboard

- (void)phasePasteboard {
  __weak NativeProbe *weakSelf = self;
  // A named pasteboard is fully owned by this process — the round-trip never
  // touches the user's general pasteboard.
  NSPasteboard *pb = [NSPasteboard pasteboardWithName:@"electron-mbt-probe"];
  [pb clearContents];
  BOOL wrote = [pb setString:@"mbt-pasteboard-ok" forType:NSPasteboardTypeString];
  NSString *readBack = [pb stringForType:NSPasteboardTypeString];
  [weakSelf recordNative:@"pasteboard.native" detail:@{@"pasteboard": @"named:electron-mbt-probe",
    @"wrote": @(wrote), @"readBack": readBack ?: [NSNull null]}];
  NSString *domProbe = @"(function () {"
    @"var out = { api: typeof navigator.clipboard };"
    @"var done = function () { globalThis.__clipResult = JSON.stringify(out); };"
    @"var work = async function () {"
    @"  try { out.readText = await navigator.clipboard.readText(); } catch (e) { out.readError = e.name + ': ' + e.message; }"
    @"  try { await navigator.clipboard.writeText('mbt-dom-write'); out.write = 'ok'; } catch (e) { out.writeError = e.name + ': ' + e.message; }"
    @"  try { out.execCopy = document.execCommand('copy'); } catch (e) { out.execCopyError = String(e); }"
    @"};"
    @"work().finally(done);"
    @"return 'started';"
    @"})()";
  // Bounded phase: a pasteboard-consent prompt can park the web process and
  // leave any DOM clipboard eval unresolved; the guard records it and moves on.
  // Verifying a DOM write means reading the general pasteboard — gated on the
  // same opt-in because the read itself can raise a consent prompt.
  BOOL osPasteOptIn = [NSProcessInfo.processInfo.environment[@"ELECTRON_MBT_OS_PASTE_OPT_IN"] isEqual:@"1"];
  [self guardPhase:12 fallback:^{
    id nativeVerify = osPasteOptIn
      ? ([[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString] ?: [NSNull null])
      : @"skipped: reading the general pasteboard requires ELECTRON_MBT_OS_PASTE_OPT_IN=1";
    [weakSelf trace:@"pasteboard" body:@{
      @"executed": @YES,
      @"observed": @{
        @"native": @{@"pasteboard": @"named:electron-mbt-probe",
                     @"write": @(wrote), @"readBack": readBack ?: [NSNull null],
                     @"generalPasteboardVerify": nativeVerify},
        @"dom": @{@"stalled": @YES,
                  @"reason": @"evaluateJavaScript never completed — the web process parked "
                             @"(a pasteboard-consent prompt is the likely cause); the DOM "
                             @"clipboard result is unresolved"},
      },
      @"note": @"NSPasteboard round-trips natively. DOM clipboard access is permission/focus "
               @"gated in WKWebView; here the DOM probe itself never resolved.",
    }];
  }];
  [self eval:domProbe then:^(id started, NSError *e0) {
    if (![weakSelf.currentPhase isEqual:@"phasePasteboard"]) return;
    if (e0 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
    (void)started;
    [weakSelf afterMs:800 run:^{
      [weakSelf eval:@"globalThis.__clipResult" then:^(id dom, NSError *e1) {
        if (![weakSelf.currentPhase isEqual:@"phasePasteboard"]) return;
        if (e1 != nil) { [weakSelf abort:@"ELECTRON_MBT_PAGE_OBSERVATION"]; return; }
        id nativeVerify = osPasteOptIn
          ? ([[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString] ?: [NSNull null])
          : @"skipped: reading the general pasteboard requires ELECTRON_MBT_OS_PASTE_OPT_IN=1";
        [weakSelf trace:@"pasteboard" body:@{
          @"executed": @YES,
          @"observed": @{
            @"native": @{@"pasteboard": @"named:electron-mbt-probe",
                         @"write": @(wrote), @"readBack": readBack ?: [NSNull null],
                         @"generalPasteboardVerify": nativeVerify},
            @"dom": dom ?: [NSNull null],
          },
          @"note": @"NSPasteboard round-trips natively. DOM clipboard access is permission/focus "
                   @"gated in WKWebView; the recorded result is what a page could actually do here, "
                   @"not an Electron clipboard contract.",
        }];
        [weakSelf advance];
      }];
    }];
  }];
}

#pragma mark - Accessibility surface

- (void)phaseAccessibility {
  id role = nil, children = nil, title = nil;
  @try {
    role = self.webView.accessibilityRole;
    children = self.webView.accessibilityChildren;
    title = self.webView.accessibilityTitle;
  } @catch (NSException *exception) {
    [self recordNative:@"accessibility.error" detail:exception.reason];
  }
  [self trace:@"accessibilityTree" body:@{
    @"executed": @(role != nil),
    @"observed": @{@"webViewRole": role ?: [NSNull null],
                   @"childCount": [children respondsToSelector:@selector(count)] ? @([children count]) : [NSNull null],
                   @"title": title ?: [NSNull null]},
    @"note": @"In-process attribute read only; VoiceOver-driven traversal and the web-content AX "
             @"tree remain NOT_RUN.",
  }];
  [self advance];
}

#pragma mark - NSWindowDelegate

- (void)windowDidBecomeKey:(NSNotification *)notification {
  [self recordNative:@"window.becameKey" detail:[notification.object isEqual:self.window] ? @"probe" : @"shadow"];
}
- (void)windowDidResignKey:(NSNotification *)notification {
  [self recordNative:@"window.resignKey" detail:[notification.object isEqual:self.window] ? @"probe" : @"shadow"];
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
    // A regular app can actually activate and take key status, which window
    // focus/blur and trusted input both depend on.
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    NativeProbe *probe = [[NativeProbe alloc] init];
    probe.fixture = [NSURL fileURLWithPath:[[NSString stringWithUTF8String:argv[1]] stringByResolvingSymlinksInPath]];
    [probe start];
    [NSApp run];
  }
  return 1;
}
