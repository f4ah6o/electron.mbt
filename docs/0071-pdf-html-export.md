# Offscreen PDF/HTML export

Status: Linux-verified PDF/HTML export through the adapted main, with explicit
limits; `compatible:false`.

Moji 1.0.7's `exportAs` path asks for a hidden offscreen BrowserWindow, loads a
temporary HTML file, waits for fonts, calls `webContents.printToPDF`, and writes
the returned Buffer through the save-dialog-granted path. The runtime now
provides that surface generically.

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
- The save dialog grants the selected output path; the PDF/HTML Buffer/string
  is written through `main-write-file`.

### PDF

`export-print-pdf` takes a full-document WebKit snapshot, then uses Cairo's PDF
surface to place the raster snapshot on A4/Letter/Legal pages (portrait or
landscape). The result is a real PDF (`%PDF-1.7`, A4 595x842 in the probe), but
it is **raster**: text is not selectable and print CSS/page breaks are not
honored. Internal export waits have 10/12 s deadlines below the 15 s host
request bound and use refcounted callback lifetimes.

### HTML

HTML export is the direct string write path and needs no offscreen window.

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
- Probe PDF: 3885 bytes, `%PDF-1.7`, `pdfinfo`: A4, 1 page, Producer cairo.
- Probe HTML: 75-byte file with the expected
  `<!doctype html>...HELLO_PDF...` content.
- Moji 1.0.7 open/edit/save/settings/drafts and 1.0.5 hold remain PASS.

## Limits

- PDF is image-only and capped at 700 KiB raw (base64/JSON must stay under the
  1 MiB host frame); larger exports fail with `FILE_LIMIT`.
- `executeJavaScript` does not await Promise-valued expressions; Moji's
  `document.fonts.ready` is treated as null, so a PDF may render before webfonts.
- `printBackground`/margins are not honored; page size/orientation are.
- The actual Export toolbar button was not exercised in this session's X11
  automation; the same `exportAs` handler was exercised by the probe, and the
  dialog itself was opened earlier. PNG export, drag-and-drop and macOS are
  not implemented/verified.
- `app.getPath('temp')` is app-local for policy containment rather than the OS
  temp directory. FileHandle covers only the operations used by this export.
- A subagent review identified the timeout/lifetime, directory-list/PDF caps,
  symlinked recursive mkdir, window registry, single export view and teardown
  issues above; the listed fixes were applied. Raster PDF, promise font waits,
  PNG, drag-and-drop and macOS remain open.
