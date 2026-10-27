# Offscreen PDF/HTML/PNG export

Status: Linux-verified PDF/HTML/PNG export through the adapted main, with
explicit limits; `compatible:false`.

Moji 1.0.7's `exportAs` path asks for a hidden offscreen BrowserWindow, loads a
temporary HTML file, waits for fonts, calls `webContents.printToPDF`, and writes
the returned Buffer through the save-dialog-granted path. PNG uses the same
window followed by `capturePage` slices and a streaming PNG writer. The runtime
now provides these surfaces generically.

## Implemented surface

- `new BrowserWindow({show:false, webPreferences:{offscreen:true}})` maps to a
  hidden, undecorated, taskbar/pager-skipped GtkWindow containing a private
  WebKitWebView. A second live offscreen window is rejected rather than
  silently sharing the first document.
- `loadFile` for an offscreen window uses `load-export-file` (canonical path,
  app-root/grant checked).
- `webContents.executeJavaScript` and `webContents.printToPDF` are exposed for
  offscreen windows. `printToPDF` returns a Buffer.
- `BrowserWindow.fromWebContents`, `getAllWindows`, `getFocusedWindow`,
  `fromId`, and unique window ids are available; destroyed windows are removed
  from the registry and `primaryContents` is reassigned.
- `fs.promises.open` with a minimal `"w"`/`"r"` FileHandle is enough for
  `writeExportSource`; `app.getPath('temp')` returns an app-local
  `.appData/tmp` directory created through `main-mkdir`.
- The save dialog grants the selected output path and its exact `.tmp` sibling;
  PDF/HTML Buffers/strings use `main-write-file`, while PNG uses positioned
  `main-write-at` writes and the app's temp+rename flow.

### PDF

`export-print-pdf` first runs a real WebKitGTK print operation with the
"Print to File" PDF backend, A4/Letter/Legal page setup and orientation. That
produces a **print-layout, text-selectable PDF** (Skia/PDF m145 in the probe:
520,046 bytes, A4, 1 page; `pdftotext` returns the expected markers). If the
print operation fails, times out (5 s), or its PDF exceeds the one-response
limit, the host falls back to a full-document WebKit snapshot rendered through
Cairo: a real but raster PDF (`%PDF-1.7`, 595x842, 3.8 KB in the probe).
Internal export waits have 10/12 s deadlines below the 15 s host request bound
and use refcounted callback lifetimes.

### HTML

HTML export is the direct string write path and needs no offscreen window.

### PNG

PNG export uses the app's own path:

- `webContents.capturePage(rect)` returns a `NativeImage` (`getSize`,
  `toBitmap`) populated from a host-side visible WebKit snapshot, sliced into
  bounded `export-capture-page`/`export-capture-read` responses (64 KiB reads).
- `BrowserWindow.setContentSize` resizes the hidden export window before each
  slice.
- `fs.promises.open(..., "w")` writes positioned chunks through
  `main-write-at` (the previous in-memory-only handle could not implement the
  PNG header rewrite at offset 8, nor large files).
- `zlib.createDeflate` uses the host's zlib `deflate` stream when available,
  with a stored-block fallback for hostless unit contexts. It exposes an async
  iterator and `destroy`.
- Buffer integer accessors and `Buffer.from(ArrayBuffer, offset, length)` cover
  the PNG header/CRC code.

The probes produced valid RGBA PNGs through the actual pinned Moji main:
794x1123 / 9,845 bytes for an A4 page, and 794x4020 / 94,430 bytes for a long
document spanning two capture slices. They are raster images and use real
zlib compression.

### Offscreen `loadURL`

An offscreen `BrowserWindow` also supports data-URL navigation:

```js
win.loadURL("data:text/html;charset=utf-8,...", { baseURLForDataURL: "file:///..." })
```

The data URL is decoded into `.appData/tmp`, an optional `<base href>` is
inserted from `baseURLForDataURL`, and the file is loaded through
`load-export-file`. The temporary file is removed in `destroy`. Non-data/non-
offscreen `loadURL` remains unsupported. This was verified by changing the
export probe's window to use `loadURL` instead of `loadFile`; the PDF result
was the same 3885-byte `%PDF-1.7` A4 page. The pinned Moji build itself uses
`loadFile`, so this is generic coverage rather than a required Moji path.

## Evidence

- Probe page using the actual pinned Moji main and captured `exportAs` API:
  `doc:export` → `main-save-dialog` → `.appData/tmp/*.html` → hidden export
  WebView → `export-print-pdf` → `main-write-file`.
- Probe PDF: 520,046 bytes, PDF 1.4, A4, 1 page, Producer Skia/PDF m145;
  `pdftotext` returns `PRINT LAYOUT` and `SELECTABLE_TEXT_MARKER`. The snapshot
  fallback remains a 3.8 KB `%PDF-1.7` Cairo PDF.
- Probe HTML: 75-byte file with the expected
  `<!doctype html>...HELLO_PDF...` content.
- Probe PNG: 794x1123 / 9,845-byte RGBA PNG and 794x4020 / 94,430-byte
  two-slice RGBA PNG, both `file`/`identify`-valid. A GDK_SCALE=2 run also
  produced 794x4020 / 94,425 bytes with all 20 bands visible.
- Moji 1.0.7 open/edit/save/settings/drafts and 1.0.5 hold remain PASS.
- The probes are manual (`_build` artifacts) using the pinned main; the
  behavioral prelude additions are covered by the zlib/Buffer assertions in
  `node_prelude_wbtest.mbt`, but there is no committed PNG/save-dialog E2E
  test. Counts: native 199 PASS, JS 163 PASS, npm 534 tests (501 PASS / 0 FAIL
  / 33 SKIP).

## Limits

- Print-layout PDF is preferred. A print result above 700 KiB, or a failed/
  timed-out print, falls back to a raster snapshot; the returned Buffer is
  frame-bounded. The response/frame and main-write caps were raised to 700 KiB
  payload / 950 KiB base64 for the 520 KB print-layout probe.
- PNG uses the host zlib stream (not stored blocks) when the host is present.
  The probe A4 page is 9,845 bytes and the 4020 px two-slice page is 94,430
  bytes. Each capture is capped at 16 MiB; output offsets are capped at
  256 MiB; very long documents are not stress-tested.
- `DeflateStream` implements `write`/`end`/`destroy` and async iteration, but is
  not a full Node stream/EventEmitter. FileHandle `"w"` creates/truncates on
  open and writes positioned chunks, but `close` has no flush/error surface.
- `capturePage` requires the returned size to equal the requested size; a
  failed GTK resize fails rather than silently omitting rows. WebKitGTK may
  return CSS- or device-sized snapshots; the host derives the ratio from the
  allocated CSS width and downscales device snapshots. A GDK_SCALE=2 probe
  produced the same 794x4020 / 94,425-byte PNG with all slices intact (CSS-
  resolution output, not 2x native pixels).
- The `.tmp` sibling grant is exact-path, write-only and session-long; it is
  documented in [docs/0047](0047-node-less-main-user-file-grants.md).
- `executeJavaScript` does not await Promise-valued expressions; Moji's
  `document.fonts.ready` is treated as null, so a PDF may render before webfonts.
- `printBackground`/margins are not honored; page size/orientation are.
- The actual Export toolbar button was not exercised in this session's X11
  automation; the same `exportAs` handler was exercised by the probe, and the
  dialog itself was opened earlier. Drag-and-drop and macOS are not
  implemented/verified.
- `app.getPath('temp')` is app-local for policy containment rather than the OS
  temp directory. FileHandle covers only the operations used by this export.
- Two subagent reviews identified the timeout/lifetime, directory-list/PDF
  caps, symlinked recursive mkdir, window registry, single export view, zlib
  buffering, capture caps, FileHandle and `.tmp` issues; the listed fixes were
  applied. Print-layout PDF and HiDPI are now verified; promise font waits,
  drag-and-drop, Export UI automation and macOS remain open.
