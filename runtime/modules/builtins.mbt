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
    "fs": ["existsSync", "readFileSync", "writeFileSync"],
    "fs/promises": ["readFile", "writeFile"],
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
