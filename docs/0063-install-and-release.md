# Install and release (not yet published)

Status: **prepared, not executed**. No GitHub Release, Mooncakes publication,
npm publication or `moon binstall` installation has been performed.

## Mooncakes and `moon binstall`

`moon.mod` is `f4ah6o/electromoon` version `0.1.0`, `preferred_target = "native"`.
`moon-binstall.json` maps two phantom package paths to release assets:

- `cmd/emoon` → installed binary `emoon`.
- `cmd/emoon-host` → installed binary `emoon-host`.

The manifest uses `{repo}/releases/download/v{version}/{bin}-{target}` with
`pkg-fmt: "bin"`. The phantom paths follow the moon-binstall precedent of
keeping a package key that need not be a real MoonBit package.

Planned install (after publication):

```sh
moon install f4ah6o/moon-binstall@0.1.6
moon binstall f4ah6o/electromoon/cmd/emoon f4ah6o/electromoon/cmd/emoon-host@0.1.0
export PATH="$HOME/.local/bin:$PATH"
emoon version
```

## Release assets

The planned matrix is `linux-x86_64`, `linux-aarch64` and `darwin-aarch64`.
`darwin-x86_64` is not built. Each release needs `emoon-{target}` and
`emoon-host-{target}` with GitHub's SHA-256 asset digest. The Linux binaries are
built on ubuntu-24.04 and need the declared glibc minimum. The host also needs
GTK 3 and WebKitGTK 4.1 at run time; `moon binstall` checks the ELF dependency
metadata and refuses an incompatible host.

macOS signing and notarization are **not** implemented. The preview is unsigned.

## Native build from source

```sh
node scripts/build-cli.cjs
dist/emoon --version
dist/emoon-host --version
```

`cmd/emoon` is built by MoonBit; `cmd/emoon-host` is built by the platform
scripts. The CLI resolves the host from `--host`, `EMOON_HOST`, a sibling of the
CLI, `dist/emoon-host` in the current directory, or an absolute `PATH` entry.
`node scripts/build-cli.cjs` builds release+strip by default; use `--debug` for
the old debug binary.

`emoon bundle` can produce a single self-extracting ELF that embeds the host and
the app stage. When run inside a built Electron app it stages
`.emoon/app` if needed and writes
`<app>/.emoon/dist/<name>-<version>-<os>-<arch>`; no `--output` is required. The
preview is unsigned; see [docs/0073](0073-one-step-bundle-ux.md) and
[docs/0072](0072-single-executable-bundle.md).

## npm (Node reference CLI)

`package.json` exposes `bin: { "emoon": "cmd/emoon.cjs" }` and a limited `files`
list. `npm pack --dry-run` is the packaging check. Publishing requires the
owner's npm token and is not done by this repository's CI. The Node CLI delegates
`doctor`/`run`/`bundle` to a separately installed native runtime; it never
downloads one implicitly.

## Not run

- `moon publish`
- GitHub Release creation
- `moon binstall`
- `npm publish`
- clean-machine install and smoke tests
- macOS native execution and signing
