# Adapted sender authority and main-to-page events

Status: generic adapted-runtime support, Linux-verified; `compatible:false`.

Moji 1.0.7's main wraps every renderer handler in:

```js
function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event.sender !== mainWindow.webContents) return false;
  return event.senderFrame === null || event.senderFrame === event.sender.mainFrame;
}
```

The adapted bridge previously passed `{sender:{id:0}}`, so every
`handleFromRenderer` call threw `forbidden` — including `file:open-dialog`,
`settings:get`, drafts and updates. The initial UI only appeared because it used
defaults; the open dialog never reached the host.

## Changes

- `event.sender` is now the actual `BrowserWindow.webContents` object (same
  identity as the app's `mainWindow.webContents`), `event.senderFrame` is `null`,
  and `webContents.mainFrame` aliases the webContents. `webContents.isDestroyed()`
  and `webContents.id` are available.
- `webContents.send(channel, ...args)` now calls the host
  `send-adapted-event` operation. The host evaluates
  `window.__electronMbtDispatch(nonce, topic, JSON.parse(payload))` in the page;
  the adapted adapter only emits topics listed in the captured manifest.
- `AbortController` / `AbortSignal` support (`abort`, `aborted`, `reason`,
  `addEventListener`/`removeEventListener`, `throwIfAborted`, `onabort`) was
  added; Moji's open-many code used `new AbortController()` before sending
  progress.
- Main handler failures now include the error message in the app reply; the
  host passes it to the page error instead of only the generic
  `ELECTRON_MBT_MAIN_ERROR`.

## Evidence

- A probe page with the captured 1.0.7 API calls
  `window.api.openDialog()` on load. With the test dialog auto-select it now
  reaches `main-open-dialog`, auto-selects the sample file and prints:

  `RESULT {"total":1,"sessionId":"...","ok":true}`

  Before the sender fix the same probe printed
  `ERROR ELECTRON_MBT_MAIN_ERROR ELECTRON_MBT_MAIN_ERROR` with no host dialog.
- The Moji 1.0.7 adapted initial UI still loads; 1.0.5 remains PASS.
- `moon test --target native`: 198 PASS; JS: 163 PASS; `npm test`: 534 / 501
  PASS / 0 FAIL / 33 SKIP.

## Limits

- Verified with a probe page: `openDialog()` returns a session, then
  `startOpenMany()` produces `file:open-many-progress` and
  `file:open-many-done` in the page.
- Verified in Moji 1.0.7 itself: Ctrl+O opens the auto-selected file, the
  renderer receives progress/done, `emoon:read-file` returns its bytes, and the
  preview renders. Editing + Ctrl+S wrote the edited file; settings and recent
  files persisted. See [docs/0070](0070-main-fs-directories.md).
- Detached app work is pumped by `AppRunner::pump_idle` from the CLI host loop
  after the app reply, so fire-and-forget async tasks get promise/timer turns
  without calling the host while it is still waiting for the reply.
- `ipcMain.on` listeners are also dispatched for adapters that use send-style
  channels (for example `app:renderer-ready`).
- The main-to-page event route is implemented on Linux only; macOS remains
  unverified. Send is fire-and-forget with no acknowledgement.
- Draft autosave, the Settings panel and the Export dialog are verified. PDF
  and HTML export now run through an offscreen WebView (PDF is raster); PNG,
  drag-and-drop and macOS remain unverified. No `compatible:true` is produced.
