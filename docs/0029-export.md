# Export (partial)

Status: **partial**. `doc:export` HTML and `diagram:export-png` write through a
test-injected save path with compiled AppKit `NSSavePanel` code. PDF/PNG
document rendering and the panel UI are **NOT RUN / NOT IMPLEMENTED**.

## Behavior

- `doc:export({format:"html", html, baseName})` writes the HTML atomically and
  replies `{ok:true, path, bytes}`. HTML is bounded to 64 KiB.
- Other document formats (`pdf`, `png`) are rejected with
  `ELECTRON_MBT_EXPORT_UNSUPPORTED`; rendering is not implemented.
- `diagram:export-png({dataUrl:"data:image/png;base64,...", baseName})` checks
  the prefix and PNG magic, decodes, writes atomically and replies
  `{ok:true, path, bytes}`. PNG data is bounded to 1 MiB.
- Both use an exact `readwrite` grant on the selected save path. The test path
  comes from `set-dialog-result` kinds `export-html` / `export-png`; production
  uses an `NSSavePanel` sheet (compiled, UI NOT RUN).
- Invalid export requests fail closed with
  `ELECTRON_MBT_EXPORT_INVALID`; cancel is `ELECTRON_MBT_FILE_CANCELED`.

## Evidence

The supervisor sets `broker-export.html` and `broker-export.png` as test save
paths, then the page:

1. exports `<h1>export</h1>` and checks 15 bytes;
2. reads `broker-export.html` and checks the exact HTML;
3. exports the 1×1 PNG data URL and checks `ok:true`;
4. reads `broker-export.png` through `file:read-image` and checks the PNG data
   URL.

The supervisor reports `exportHtml:true` and `exportPng:true`,
`nativeIngressAdmitted:22`, `nativeIngressDenied:4`. Test artifacts are removed
by the probe wrappers.

## Deliberate limits

- the AppKit save panel is compiled but its UI is **NOT RUN**
- no PDF/PNG document rendering (no print, no `htmlToPdf`/`htmlToPng`)
- `assetBaseUrl`, page size/orientation and Moji's export window are ignored
- test paths are app-root-only; production panel paths can be outside the app
  root through the exact dialog grant
- no Moji main handler, no real Moji export flow
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

- implement document PDF/PNG rendering through WebKit print/offscreen windows
- exercise the real save panel UI manually
- then Moji main/preload boot
