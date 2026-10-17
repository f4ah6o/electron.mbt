# Dialogs (partial)

Status: **partial**. `file:open-dialog` and `file:save-as` now have a
test-injected grant path and compiled AppKit `NSOpenPanel`/`NSSavePanel` sheets.
The panel UI itself is **NOT RUN** in the automated probe.

## Behavior

- `file:open-dialog` selects one file, resolves it, grants `read` and replies
  `{path, paths:[path], source}`. Cancel replies
  `ELECTRON_MBT_FILE_CANCELED`; no window replies
  `ELECTRON_MBT_FILE_DIALOG_UNAVAILABLE`.
- `file:save-as(content, suggestedName)` shows a save sheet, grants `readwrite`
  to the selected file, writes atomically and replies
  `{path, bytes, source}`. Content is bounded to 64 KiB.
- Dialog-selected absolute paths are allowed outside the app root only through
  the exact grant created by the panel. A page cannot grant itself a path.
- `set-dialog-result` is a **test-only** control operation that supplies
  `kind: open|save` and an app-root path instead of showing a panel. It is the
  only dialog path exercised automatically.
- The panels are sheets on the existing native window; they do not block the
  host loop and reply from the completion handler.

## Evidence

The supervisor sets the test dialog results to
`samples/sample.md` (open) and `broker-save-as.txt` (save), then the page:

1. opens the test dialog and checks the sample path and `source:"test-dialog"`;
2. saves `saved-by-dialog` through `file:save-as` and checks 15 bytes;
3. reads `broker-save-as.txt` back and checks the content.

The supervisor reports `fileDialog:true` and `fileSaveAs:true`;
`nativeIngressAdmitted:18`, `nativeIngressDenied:4`. The test save artifact is
removed by the probe wrappers.

## Deliberate limits

- the AppKit panels are compiled but the UI is **NOT RUN**; no human click or
  file-system sandbox consent is exercised
- `set-dialog-result` is test-only, not a production consent path
- single-file selection only; no directory grants, no multiple selection
- no `file:open-local-path`
- no export / save-panel document export
- the save path is an exact grant; directory-level grants are read-only in this
  slice
- no Moji main handler, no real Moji save/open flow
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- exercise the real panel UI manually and record the environment
- add export/save-panel document and PNG writes
- then Moji main/preload boot
