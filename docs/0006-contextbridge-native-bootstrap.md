# Native isolated bootstrap for trusted-host bridge scopes

Status: **partial internal precondition only**. This continues Draft PR #10,
stacked on PR #2. Normal `run` and `pack` remain fail-closed and
`contextBridge:NOT_IMPLEMENTED`, M0 OPEN, `compatible:false`, row C planned
are unchanged.

## Runtime implementation

The production macOS WKWebView host now installs one private
`WKScriptMessageHandlerWithReply` in a named `WKContentWorld`, distinct from
pageWorld. At each host-authorized file navigation, it replaces its own
document-start script with a new native-generated UUID nonce. The script
sends exactly one bootstrap message to the private isolated handler. It does
not expose a function, DOM token, event listener, IPC API or bridge to pageWorld.

The native handler requires the actual `WKScriptMessage.frameInfo.isMainFrame`,
its own WKWebView/controller, a canonical file request URL equal to the
host-authorized file, exact message shape and the current navigation nonce.
The record is one-shot for its document generation. Previous document tokens
are invalidated before `stopLoading` or navigation begins; load failure,
WebKit termination, teardown and close also clear them. The read-only,
private-control-lane `get-bootstrap-status` only reports successful isolated
document-start execution after the matching file finishes loading. It
returns the actual WebView document URL, **not** an asserted security origin
or proof of who originated arbitrary later page interactions. No nonce
leaves the isolated world or the native host.

Trusted Node main can call `bootstrapScopeForTrustedHost(window, channel)`.
This rejects pending loads, lost or destroyed windows and absent native
bootstrap evidence. It checks exact window/generation/document URL against
two native observations, and then uses MoonBit to activate the document and
grant an internal channel for the existing bounded host-local JS registry.
Repeated grants in the same document do not reactivate it; a new generation
requires a new native bootstrap. This helper is not included in the Electron
facade or reachable from renderer, and the raw registry remains an
internal host-only API.

## Trust and compatibility boundary

The isolated bootstrap proves only a WebKit-owned isolated document-start
handler ran for the expected file and current navigation nonce. The host
controls the application root, navigation and installed script. It does
**not** authenticate the initiating page/frame of a later shared-DOM event,
prove secure synchronous cross-world replies, load an unchanged sandboxed
preload, or expose Electron's `contextBridge.exposeInMainWorld`.

No arbitrary untrusted caller may supply the native frame flag, origin or
document token to create a privileged scope. No permission-bearing page
listener, shared DOM reply channel, pageWorld preload or synchronous
WebKit/UI thread wait has been introduced.

## Verification

`tests/context-bridge-bootstrap-native.test.cjs` runs only on macOS with
the real AppKit/WKWebView host. It loads an unchanged page script which
checks that the native isolated handler is invisible from pageWorld,
observes a validated main-frame bootstrap and uses the MoonBit-owned
registry to call a host-local function. It reloads the **same URL**,
asserts pending-Promise revocation and stale-handle denial, recreates
authority from the new generation and verifies window destruction and
asset hash preservation.

The existing native and pinned Electron oracle tests remain in CI. The
new test proves this narrow native bootstrap behavior, **not** Electron
cross-world security or compatibility. Compiler results and actual
macOS observations must be reported separately as PASS/FAIL/NOT RUN.
