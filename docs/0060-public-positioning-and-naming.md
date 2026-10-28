# Public positioning and naming

Status: **decided; repository rename pending**. This note does not promote any
runtime profile, compatibility row or release artifact.

## Name

- Brand, repository, MoonBit module and npm package: `Electromoon` /
  `electromoon`.
- CLI: `emoon`.
- The former name `electron.mbt` is retained in historical documents and in
  evidence identifiers. GitHub redirects the old repository URL after the
  owner renames `f4ah6o/electron.mbt` to `f4ah6o/electromoon`.

`positron` was rejected because Posit PBC's Positron IDE, an npm package and an
older QuorraJS framework already use it. `nodeless` was rejected as a brand
because it is a generic adjective, the npm name is squatted, and the separate
`desktop-core-v1` profile is Node-backed. Electron-derived product names were
rejected because `Electron` is an OpenJS Foundation trademark.

`emoon` was considered as a brand but the GitHub handle belongs to an existing
developer and `emoon.com` is registered. It is used only as the CLI token. The
`em` alias is not shipped: the npm `em` name is taken and a global `em` command
collides with other tools.

## Positioning

Electromoon targets a bounded subset of Electron applications. It runs a
CommonJS main process on QuickJS and renders in the system WebView; it does not
bundle Node or Chromium. The adapted profile generates a page adapter from an
explicit preload API manifest instead of executing the original preload.

Adjacent projects include Electron, Tauri, Wails, Neutralinojs, Electrico and
Electrobun. The comparison is descriptive: none of those projects endorses this
one, and this project does not claim their compatibility scope.

## Claim policy

- All machine-readable output carries `compatible:false` until a profile row is
  actually accepted with evidence.
- Static scans, successful builds, a window opening and a passing fixture are
  not compatibility results.
- The strict `electron-nodeless-v1` profile remains blocked. The adapted profile
  is experimental and app-scenario scoped.
- No size, startup, memory, security or "drop-in" claim is made without a
  recorded measurement on the same source, profile and environment.

## Naming and compatibility identifiers

The public brand is Electromoon. The following identifiers are intentionally
retained for compatibility and evidence integrity:

- `ELECTRON_MBT_*` diagnostic codes and environment variables.
- `electron-nodeless-v1` and `electron-nodeless-adapted-v1` profile IDs.
- `nodeless-*` fixture and probe IDs.
- The `electron-mbt-app://` renderer origin.
- Existing records under `compatibility/`.

Renaming the origin or the diagnostic prefix requires a migration note and new
evidence; it is not part of a cosmetic rename.
