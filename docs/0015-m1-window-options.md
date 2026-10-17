# M1 BrowserWindow option coverage (partial)

Status: **partial**. The M1 main-process facade now accepts a bounded option set
and applies position, minimum size and background colour through validated
native operations. It does not claim Electron BrowserWindow parity.

## Applied

| Option | Behaviour |
| --- | --- |
| `width` / `height` | initial content size; 100–4096 |
| `x` / `y` | integer position applied with a native bounds update |
| `minWidth` / `minHeight` | integer 0–4096; native `contentMinSize` |
| `backgroundColor` | `#rrggbb`; native NSWindow background colour |
| `title` / `show` | existing native title/visibility |
| `webPreferences.preload` | existing bounded preload source/hash admission |

`width`/`height` remain the content size contract; the native host converts the
outer frame. The new native operations validate exact payloads and reject stale
document generations.

## Accepted but not applied

- `icon`: checked as an existing file inside the app root, but macOS window icon
  identity is not installed.
- `autoHideMenuBar`: boolean is retained only on the JS window object; there is
  no native menu bar because the Menu model is not installed as an NSMenu.

These omissions are explicit; they must not be reported as Electron-compatible
window behaviour.

## Verified

- `moon test --target js -p transport` validates min-size/background payloads
  and exact ACKs.
- `tests/runtime-options.test.cjs` covers option application and rejection.
- `scripts/m1-macos-smoke.cjs` covers native min-size/background set/get,
  malformed requests and stale generations.
- `m1-app-smoke.cjs` remains PASS.

## Next blocker

The isolated Moji boot now creates the BrowserWindow and applies options, then
`loadFile` fails at preload with:

```text
ELECTRON_MBT_PRELOAD_UNSUPPORTED_API
Native load operation failed
```

The preload uses `contextBridge`/`ipcRenderer`, which the M1 preload world does
not support yet. No window/app scenario is accepted.
