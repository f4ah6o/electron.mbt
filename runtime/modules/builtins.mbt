///|
pub(all) enum BuiltinStatus {
  Planned
  Unsupported
} derive(Eq, Debug)

///|
fn builtin_name(specifier : String) -> String {
  if specifier.has_prefix("node:") {
    specifier[5:].to_owned()
  } else {
    specifier
  }
}

///|
fn builtin_table() -> Map[String, BuiltinStatus] {
  {
    "path": Planned,
    "url": Planned,
    "fs": Planned,
    "fs/promises": Planned,
    "buffer": Planned,
    "events": Planned,
    "process": Planned,
    "zlib": Planned,
    "child_process": Unsupported,
    "worker_threads": Unsupported,
    "vm": Unsupported,
    "net": Unsupported,
    "tls": Unsupported,
    "http": Unsupported,
    "https": Unsupported,
    "http2": Unsupported,
    "dns": Unsupported,
    "crypto": Unsupported,
    "stream": Unsupported,
    "readline": Unsupported,
    "repl": Unsupported,
    "cluster": Unsupported,
    "inspector": Unsupported,
    "module": Unsupported,
    "perf_hooks": Unsupported,
    "async_hooks": Unsupported,
    "v8": Unsupported,
    "wasi": Unsupported,
    "test": Unsupported,
    "assert": Unsupported,
    "querystring": Unsupported,
    "string_decoder": Unsupported,
    "timers": Unsupported,
    "tty": Unsupported,
    "dgram": Unsupported,
    "diagnostics_channel": Unsupported,
    "trace_events": Unsupported,
    "os": Unsupported,
    "util": Unsupported,
    "_http_agent": Unsupported,
    "_http_client": Unsupported,
    "_http_common": Unsupported,
    "_http_incoming": Unsupported,
    "_http_outgoing": Unsupported,
    "_http_server": Unsupported,
    "_stream_duplex": Unsupported,
    "_stream_passthrough": Unsupported,
    "_stream_readable": Unsupported,
    "_stream_transform": Unsupported,
    "_stream_wrap": Unsupported,
    "_stream_writable": Unsupported,
    "_tls_common": Unsupported,
    "_tls_wrap": Unsupported,
    "assert/strict": Unsupported,
    "console": Unsupported,
    "constants": Unsupported,
    "dns/promises": Unsupported,
    "domain": Unsupported,
    "inspector/promises": Unsupported,
    "path/posix": Unsupported,
    "path/win32": Unsupported,
    "punycode": Unsupported,
    "readline/promises": Unsupported,
    "stream/consumers": Unsupported,
    "stream/promises": Unsupported,
    "stream/web": Unsupported,
    "sys": Unsupported,
    "timers/promises": Unsupported,
    "util/types": Unsupported,
  }
}

///|
// Planned means the initial Node subset needs the surface; it does not mean a
// shim is implemented or accepted. Unknown `node:` names are unsupported.
pub fn builtin_status(specifier : String) -> BuiltinStatus? {
  let name = builtin_name(specifier)
  match builtin_table().get(name) {
    Some(status) => Some(status)
    None =>
      if specifier.has_prefix("node:") {
        Some(Unsupported)
      } else {
        None
      }
  }
}

///|
fn builtin_symbols_table() -> Map[String, Array[String]] {
  {
    "path": ["join", "dirname", "extname", "isAbsolute", "resolve"],
    "url": ["fileURLToPath", "pathToFileURL", "URL"],
    "fs": ["existsSync", "readFileSync", "writeFileSync", "statSync", "readdirSync", "mkdirSync"],
    "fs/promises": ["readFile", "writeFile", "stat", "readdir", "mkdir"],
    "buffer": ["from", "alloc", "concat", "subarray", "toString"],
    "events": ["EventEmitter", "on", "once", "off", "emit"],
    "process": ["platform", "arch", "argv", "env", "resourcesPath"],
    "zlib": ["createDeflate"],
  }
}

///|
pub fn builtin_symbols(specifier : String) -> Array[String] {
  match builtin_symbols_table().get(builtin_name(specifier)) {
    Some(symbols) => symbols.copy()
    None => []
  }
}

///|
pub fn is_builtin(specifier : String) -> Bool {
  builtin_status(specifier) is Some(_)
}
