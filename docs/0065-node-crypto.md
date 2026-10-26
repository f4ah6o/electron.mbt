# `node:crypto` subset

Status: implemented subset, Linux-verified; `compatible:false`. This is a
runtime-provided module for the bounded Node surface, not a Node compatibility
claim and not a general WebCrypto implementation.

## Surface

| API | Behaviour |
| --- | --- |
| `createHash('sha256')` / `'sha-256'` | SHA-256; `.update(string \| Buffer \| ArrayBuffer \| number[])`; `.digest('hex' \| 'base64' \| undefined)` |
| `randomUUID()` | RFC 4122 version 4 UUID from host entropy |
| `randomBytes(size[, callback])` | 0..65536-byte Buffer; a callback is invoked synchronously |
| `getRandomValues(array)` | fills a `Uint8Array`/Buffer up to 65536 bytes |
| `webcrypto.getRandomValues` | alias of `getRandomValues` |

Anything else (for example `md5`, `sha1`, HMAC, `sign`/`verify`, `webcrypto.subtle`
or a non-hex/base64 digest encoding) fails with
`ELECTRON_MBT_UNSUPPORTED_API`. Hash input is bounded at 64 MiB. Only
`require('node:crypto')` / `require('crypto')` is provided; the original
application preload is still not executed.

## Entropy

- Linux: `getrandom(2)`.
- macOS: `arc4random_buf` (compiled, not executed on this host).
- Other POSIX: `/dev/urandom`.
- If the host bridge is not installed, `randomUUID`/`randomBytes`/
  `getRandomValues` fail closed with `ELECTRON_MBT_HOST_UNAVAILABLE`; there is no
  `Math.random` fallback.
- The random byte length is capped at 65,536 bytes in C and in the JS wrapper.

## Evidence

- Native prelude test: SHA-256 vectors for the empty string and `abc`, base64
  digest, empty digest Buffer, UUID v4 shape/variant/uniqueness, random byte
  length, `getRandomValues`, and the unsupported-algorithm code.
- `moon test --target native`: 197 PASS; `--target js`: 163 PASS.
- `npm test`: 533 tests / 500 PASS / 0 FAIL / 33 SKIP.
- Moji 1.0.5 adapted hold window still reaches `HOLDING`/`HOLD_EXIT` and exits 0.

The pinned Moji 1.0.7 main now gets past `node:crypto`. After the follow-up
v8/os/perf_hooks/protocol surfaces, its main and window boot; the plain renderer
still has no adapted API. See [docs/0066](0066-node-runtime-surfaces.md).
macOS entropy and a full 1.0.7 renderer window remain NOT RUN.

Files: `bridges/embedded-js/node_prelude.mbt`,
`bridges/embedded-js/quickjs_adapter.c`, `runtime/modules/builtins.mbt`.
