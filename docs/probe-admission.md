# macOS probe-report admission

Status: implementation increment; M0 remains open and `compatible:false`.
This does not replace or close
`issues/polished/0001-electron-compatible-lightweight-runtime.md`.

## Boundary

`platform/macos/WKSyncBridgeProbe.m` and `platform/macos/WKNativeProbe.m`
collect observations. `scripts/macos-probe.cjs` admits the report; it does not
turn a probe run into Electron compatibility evidence. The native producers and
the JS validator both refuse to score a missing observation as expected, so a
malformed report cannot support `NO_PUBLIC_SYNC_PROXY` or a native-acceptance
claim.

## Required observations

For every **executed** `wksyncbridge` candidate, the report must carry:

| Candidate | Observation |
| --- | --- |
| `crossWorldFunctionReference` | string `pageFnVisibleFromIsolated`, string `isolatedFnVisibleFromPage` (`undefined` on both sides) |
| `domEventDispatchChannel` | array `isolatedListenerCalls` (`callable` Boolean per item), Boolean `syncRoundTripViaSharedDom`, string/null `writeBack`, Boolean/string `dispatcherCaughtThrow` |
| `sharedLocalStorage` | string/null `pageWrite`, string/null `isolatedRead` |
| `jsDialogChannel` | string/null `prompt`, string `promptTypeof`, number `promptBlockMs`, string/null `latePrompt`, Boolean/null `confirm`, number `confirmBlockMs`, null/string `alert`, array `delegateCalls` |
| `scriptMessageHandlers` | strings `plainReturnType`/`replyReturnType`/`settlementAfterTick`, Booleans `plainIsPromise`/`replyIsPromise`/`settledSynchronously`, string/object `pageWorldSeesIsolatedHandler`, array `deliveries` |
| `evaluateJavaScriptAsync` | number `value` (`2`), Boolean `completionOnLaterRunLoopTurn` (`true`) |
| `syncXhrToUrlSchemeHandler` | object `xhr` with string `response` or string `error` (optional number `blockMs`), array `schemeTasks` |

For every **executed** `wknative` trace, the report must carry:

| Trace | Observation |
| --- | --- |
| `windowFocusBlur` | objects `afterActivate`/`afterShadowKey`/`native`, Booleans `domFocusEvent`/`domBlurEvent`, array `keyNotifications` |
| `resizeAndDpi` | objects `before`/`after`, number `windowBackingScaleFactor`, non-negative integer `screenCount`, `after.resizeEvents >= 1`, changed inner viewport |
| `inputDomSynthesis` | string `inputValueAfterSyntheticEvents`, Boolean `documentFocused`, array `events`, Boolean `anyTrustedEvent` |
| `inputOsEvent` | objects `focusState`/`paths`, string `inputValue`, array `domEvents`, Boolean `trustedEventSeen` |
| `osPaste` | objects `paths`/`focusState`, string/null `inputValue`, Booleans `pasteEventSeen`/`pasteEventTrusted` |
| `pasteboard` | object `native` (`write:true`, `readBack:"mbt-pasteboard-ok"`), object `dom` with stalled/skipped reason or an `api` string |
| `accessibilityTree` | non-null string `webViewRole`, number/null `childCount`, string/null `title` |

`NOT_RUN` entries require a non-empty `reason`; stalled entries additionally
require a recorded stall marker. Both are warnings and are never counted as
exercised. `coverage` is recomputed from the entries; self-reported counts that
do not match are rejected. Unknown entries and statuses inconsistent with the
recorded observations are rejected.

## Clipboard side effects

- Default: the named NSPasteboard round-trip runs; DOM clipboard
  read/write/copy is NOT_RUN and the general pasteboard is untouched.
- `ELECTRON_MBT_OS_PASTE_OPT_IN=1`: the DOM read/write/copy probe and the
  general-pasteboard verification may run. Use only a disposable environment.
- The native producer treats `NSNull`/wrong shapes as observation errors and
  derives `INCONCLUSIVE` instead of an expected outcome.

## Verification

```sh
node --test tests/macos-probe-validation.test.cjs
node scripts/macos-probe.cjs --build-only
node scripts/macos-probe.cjs
```

The default probe run is safe for a developer machine. The opt-in run is not
part of routine local verification. A PASS applies only to the listed probe
observations on the recorded environment; it is not a native or compatibility
acceptance result.
