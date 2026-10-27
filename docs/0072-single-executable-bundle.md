# Single-executable bundle

Status: **implemented and verified on Linux x86_64 for Moji 1.0.7**.
`compatible:false`; this is a packaging feature, not an Electron compatibility
result. macOS execution, signing and notarization are NOT RUN.

## What it is

`emoon bundle` turns a prepared stage (`.emoon/app`) into **one native ELF**
containing:

- the release/stripped emoon CLI
- the platform `emoon-host` binary
- the complete app stage, excluding `.appData` and `.userData`

The output is a self-extracting launcher: it extracts the host and app into XDG
directories on first launch, then runs the existing Node-less runtime and native
host. It is **one file to distribute**, not a statically linked GTK/WebKit
binary. System GTK 3 and WebKitGTK 4.1 are still required.

```sh
dist/emoon bundle _build/Moji --output _build/Moji-1.0.7-linux-x86_64
_build/Moji-1.0.7-linux-x86_64
_build/Moji-1.0.7-linux-x86_64 --bundle-info
```

## Measured size

| item | size |
| --- | ---: |
| Moji 1.0.7 stage (143 source-manifest files) | 12,959,604 bytes |
| compressed payload (zlib level 9) | 3,693,792 bytes |
| `emoon-host` | 140,048 bytes |
| release/stripped `dist/emoon` (current build) | 2,490,888 bytes |
| **Moji single executable** | **6,185,192 bytes (5.9 MiB)** |
| app files extracted on first run | ~13 MB |
| host cache | ~140 KB |
| Electron runtime directory in the same Moji checkout | 317 MB |

The single file is about **5.9 MiB**, below the 8 MiB target. First-run extracted
data is about 19 MiB including the executable. The Electron comparison is the
`node_modules/electron/dist` directory in this checkout (317 MB); it is a size
comparison, not a RAM or startup comparison.

On this machine, the Moji bundle reached `HOLDING` in **~1.2 s** after launch.
The RSS sum of the CLI, host, network process and WebKit web process at HOLDING
was **~554 MiB**. This is recorded as a measurement; no RAM advantage over
Electron is claimed.

## Container format

The CLI ELF is followed by a zlib-compressed payload and a 512-byte footer.
Payload entries carry a path, kind (host/app), mode and size. The footer stores
the payload offset, stored/raw lengths, SHA-256 of both, host SHA-256, app name
and app version.

- zlib level 9; if compression is not smaller the payload is stored raw
- raw payload limit 64 MiB, host 16 MiB, 4096 files, 32 MiB per app file
- expansion verifies the stored SHA-256, inflates under a fixed raw cap, and
  verifies the raw SHA-256 before parsing
- the normal runtime still verifies `source-manifest.json` hashes/bytes

## XDG layout

```text
$XDG_DATA_HOME/electromoon/apps/<app-slug>/
  app/                 # extracted stage; .appData / .userData live here
  bundle.json          # payload/host hash + app version
  .lock

$XDG_CACHE_HOME/electromoon/hosts/<host-sha256>/emoon-host
```

- app-slug is sanitized from `package.json` name
- first launch extracts app files; subsequent launches with a matching marker
  skip extraction
- updates overwrite app files but never `.appData` / `.userData`
- `XDG_DATA_HOME` / `XDG_CACHE_HOME` fall back to `$HOME/.local/share` and
  `$HOME/.cache`
- no app data is embedded in or deleted by the bundle

## Security and failure modes

- output refuses an existing file without `--force`, a symlink, a directory,
  the running executable and any path inside the stage
- stage walk rejects symlinks/non-regular files and paths over the limits
- extraction rejects absolute paths, `..`, NUL, duplicate `.appData` /
  `.userData` entries and symlinked parents; writes use `O_NOFOLLOW` /
  `O_EXCL`, per-file temp + rename, 0700 directories, 0600 app files and 0700
  hosts
- corrupt footer, truncated payload, hash mismatch and inflate failure produce
  `ELECTRON_MBT_BUNDLE_CORRUPT`/related typed errors and exit 1
- extraction is serialized with `flock`

The footer hash detects corruption. It is **not a signature**; the preview is
unsigned.

## Command

```sh
emoon bundle <app-or-stage> --output <file> [--force] [--host <path>] [--name <name>]
```

- `<arg>/source-manifest.json` means a prepared stage
- otherwise `<arg>/.emoon/app` is used
- `source-manifest.json` is parsed and every listed file's SHA-256 is checked
  before the C writer runs
- a missing stage is `ELECTRON_MBT_BUNDLE_STAGE`; bundle never runs migrate
- `--host` overrides `EMOON_HOST` / same-directory host / `dist/emoon-host`
- `--name` overrides the sanitized app slug

The Node reference CLI does not implement `bundle`; this is a native-runtime
feature. The historical M0 `pack` command is unchanged and not this feature.

## Build

`scripts/build-cli.cjs` now builds **release + strip by default**:

```sh
node scripts/build-cli.cjs          # release-strip
node scripts/build-cli.cjs --debug  # old debug build
```

The bundle uses the CLI bytes as its prefix. Building with a debug CLI produces a
larger file; release/strip is required for the measured lightweight result.

## Verification

`tests/emoon-bundle.test.cjs` covers:

- one ELF + metadata
- no adjacent host/app; clean XDG launch
- second launch and `.appData` sentinel preservation
- existing output / missing stage / corrupt payload
- stage symlink and output symlink rejection
- Moji 1.0.7 bundle when the stage exists and the CLI is release-sized

Moji evidence:

```text
bytes=6,185,192
compression=zlib
rawBytes=13,108,339
storedBytes=3,693,792
app=moji 1.0.7 files=144
pageTitle="Moji v1.0.7"
```

NOT RUN: macOS bundle launch/signing/notarization, Windows, human UI of the
bundled app, DnD, production packaging.
