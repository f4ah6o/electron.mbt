# ADR-0001: Runtime profiles, authority ownership and profile admission

Status: accepted-for-design
Date: 2026-10-17
Scope: EP-06 / 0006, input to EP-08/10/13/14
Supersedes: none

## Context

electron.mbt currently has one manifest profile, `desktop-core-v1`, a Node-backed
compiled MoonBit core and feasibility probes. It has no native supervisor,
QuickJS runtime, adapted page API or production renderer ingress. The planned
Node-less path must not be confused with the strict Node-backed path, and a
single Boolean compatibility claim cannot represent engine, bridge, input mode,
preload mode, verification scope and release readiness independently.

## Decision

### Profiles

The runtime admits exactly these profile IDs:

| Profile | Engine | Runtime | Preload mode | Initial gate |
| --- | --- | --- | --- | --- |
| `desktop-core-v1` | Node | `node-backed` | original | open |
| `electron-nodeless-v1` | QuickJS | `quickjs-native` | original, strict | blocked |
| `electron-nodeless-adapted-v1` | QuickJS | `quickjs-native` | generated adapter | open |
| `moonbit-native-v1` | MoonBit | `moonbit-native` | none | open |

A profile is an admission input, not a compatibility result. All profiles keep
`compatible:false` in the current contract. `gate:satisfied` is allowed only
when `verification:passed`; a blocked profile must carry a non-empty reason.
Unknown profiles and selections not declared by the profile are rejected before
app evaluation.

### Sole authority

1. MoonBit owns lifecycle, window/document generations, grants, request
   terminal state, limits and diagnostics. One session has one authority.
2. The main JS realm owns its functions, closures, listeners and Promise
   capabilities. MoonBit may own opaque handles and ordering, not function
   bodies.
3. Native adapters own OS objects (`NSWindow`, `WKWebView`, `WKNavigation`,
   frame observations) and translate callbacks into typed events.
4. Renderer content is untrusted. It never receives raw native handles, file
   descriptors, transport descriptors or a generic privileged channel.
5. The Node-backed compiled core stays in place as a separate profile. The
   Node-less native supervisor must not silently replace or reuse its process
   topology as evidence.

### Direct sender and authorized relay

A direct native sender is identified from actual WebView/frame/document state,
not from a renderer-supplied JSON field. An app may deliberately relay a child
request through a public wrapper; that is a capability the app chose to expose,
not native proof that the child was the direct initiator. The two cases are
recorded separately in the sender ADR and oracle fixtures (0007 B1). Neither
case may use a `mainFrame:true` or origin string supplied by the renderer as
authority.

### Adapted is independent

`electron-nodeless-adapted-v1` is not a fallback for strict failure. It uses a
generated page adapter, declares its dependency/behavior adaptations, records
source/build/adapter hashes, and can reach `App Scenario Supported (adapted)`
without claiming strict contextBridge compatibility. `electron-nodeless-v1`
remains blocked until the EP-07 finite spike and independent evidence close it.

### State separation

`SessionReady`, `DocumentIngressReady` and `LoadComplete` are separate states.
The adapted path may use a bounded early queue for first-page API calls, but a
page's self-reported readiness is never native document authority. A failed
load, reload or host loss invalidates the lease; it does not roll back accepted
main side effects.

## Consequences

- `core/profile.mbt` and `validate_profile` are the single admission point for
  profile tuples. The CLI and tests consume the same compiled export.
- `compatibility/runtime-profiles-v1.json` is the profile contract;
  `compatibility/manifest.schema-v2.json` is the migration target while
  `compatibility/manifest.json` schema 1 remains the active CLI input.
- Strict and adapted evidence never substitute for each other. A profile or
  scope mismatch is a rejection, not a warning.
- The native host, IPC and QuickJS work packages must cite this ADR and cannot
  introduce a second grant/terminal authority.
