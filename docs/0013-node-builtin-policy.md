# Node builtin policy (EP-12 partial)

Status: **policy contract only**. `runtime/modules/builtins.mbt` classifies the
initial Node subset and records the symbols that a future shim must implement.
No Node builtin shim, filesystem access, Buffer implementation or process
bridge is enabled by this document.

## Classification

| Class | Builtins |
| --- | --- |
| planned | `path`, `url`, `fs`, `fs/promises`, `buffer`, `events`, `process`, `zlib` |
| unsupported initially | `child_process`, `worker_threads`, `vm`, `net`, `tls`, `http`, `https`, `http2`, `dns`, `crypto`, `stream`, `readline`, `repl`, `cluster`, `inspector`, `module`, `perf_hooks`, `async_hooks`, `v8`, `wasi`, `test`, `assert`, `querystring`, `string_decoder`, `timers`, `tty`, `dgram`, `diagnostics_channel`, `trace_events`, `os`, `util` |

Both `node:`-prefixed and bare names are recognized. An unknown `node:` name is
unsupported, not silently treated as a package. A non-builtin name returns
`None` so package resolution remains separate.

## Symbols

The policy records the first symbols from 0008 §10:

- `path`: join, dirname, extname, isAbsolute, resolve
- `url`: fileURLToPath, pathToFileURL, URL
- `fs`: existsSync, readFileSync, writeFileSync
- `fs/promises`: readFile, writeFile
- `buffer`: from, alloc, concat, subarray, toString
- `events`: EventEmitter, on, once, off, emit
- `process`: platform, arch, argv, env, resourcesPath
- `zlib`: createDeflate

A symbol list is a scope declaration, not evidence that the symbol behaves like
Node. `fs` behavior must still be implemented through the host broker with
permission and commit-point tests.

## Verified

`moon test --target js -p runtime/modules` and the full suites pass:

- planned vs unsupported classification, including `node:` and unsupported
  unknown names
- `electron`/package names are not classified as builtins
- symbol manifest presence/absence

## Open

- actual path/url/fs/Buffer/events/process/zlib shims
- encoding, exception and return-type parity with pinned Node
- host file broker and permission checks; no direct application filesystem
- `util`, `os`, timers, streams and the rest of the initial unsupported list
- require integration: a requested builtin must fail with a typed diagnostic
  until its shim is implemented
