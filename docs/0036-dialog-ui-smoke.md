# Native dialog UI smoke

Status: **PASS for open/cancel only**. The real AppKit `NSOpenPanel` is opened
as a sheet and programmatically canceled. No file is selected and no human
consent is exercised.

## What happens

- The supervisor UI-only mode shows the Moji window and opens
  `file:open-dialog` without a test-injected path.
- Native `openDialogWithReply` creates an `NSOpenPanel`, activates the app and
  starts the sheet.
- A test-only `cancel-active-dialog` control calls `[panel cancel:nil]` after
  500 ms.
- `get-dialog-ui-status` reports `opened/completed/canceled`; the supervisor
  requires all three and `selection:false`.

## Evidence

`node scripts/m1-moji-dialog-ui.cjs` → PASS:

```json
{"status":"PASS","probe":"moji-dialog-ui","backend":"AppKit",
 "panelOpened":true,"panelCompleted":true,"panelCanceled":true,
 "selection":false,"compatible":false}
```

Report: [compatibility/reports/moji-dialog-ui.json](compatibility/reports/moji-dialog-ui.json).
Readiness `adapted-dialog-ui` is PASS.

## Deliberate limits

- this is **open/cancel only**: no file selection, no save panel UI, no
  user-consent flow
- the panel is shown by a test-only supervisor mode; the normal probe uses
  test-injected paths
- the visible window/panel steals focus for a moment during the probe
- no human accessibility/automation or multi-select/directory test
- no production consent or permission persistence
- original preload remains NOT_EXECUTED
- `compatible:false`, adapted **partial**, strict **blocked** unchanged

## Next

- exercise a real selection with a visible window and a save panel
- record user-consent and grant persistence
- move test-only dialog controls behind an explicit test build
