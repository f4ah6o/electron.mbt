///|
pub struct ModuleSource {
  id : String
  source_hash : String
  source : String
  dependencies : Map[String, String]
  json : Bool
}

///|
pub fn ModuleSource::new(
  id : String,
  source_hash : String,
  source : String,
  dependencies : Map[String, String],
  json : Bool,
) -> ModuleSource {
  { id, source_hash, source, dependencies, json }
}

///|
pub struct CjsResult {
  status : EvalStatus
  exports : String
  cache_count : Int32
  cache_ids : Array[String]
}

///|
fn cjs_field(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn cjs_int(value : Json, key : String) -> Int32 {
  match cjs_field(value, key) {
    Number(number, ..) => number.to_int()
    _ => -1
  }
}

///|
fn cjs_texts(value : Json) -> Array[String] {
  let out : Array[String] = []
  match value {
    Array(items) =>
      for item in items {
        match item {
          String(text) => out.push(text)
          _ => ()
        }
      }
    _ => ()
  }
  out
}

///|
fn cjs_error(message : String) -> CjsResult {
  {
    status: Exception,
    exports: message,
    cache_count: 0,
    cache_ids: [],
  }
}

///|
fn cjs_bootstrap() -> String {
  "(function () {\n" +
  "  function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }\n" +
  "  const graph = globalThis.__mbt_cjs_graph;\n" +
  "  const entry = globalThis.__mbt_cjs_entry;\n" +
  "  const builtins = globalThis.__mbt_builtins || Object.create(null);\n" +
  "  const cache = Object.create(null);\n" +
  "  function load(id) {\n" +
  "    if (has(cache, id)) return cache[id].exports;\n" +
  "    const record = has(graph, id) ? graph[id] : null;\n" +
  "    if (!record) throw new Error('ELECTRON_MBT_MODULE_NOT_FOUND:' + id);\n" +
  "    const module = { id: id, filename: id, loaded: false, exports: {} };\n" +
  "    cache[id] = module;\n" +
  "    const deps = record.deps || {};\n" +
  "    function localRequire(specifier) {\n" +
  "      if (typeof specifier !== 'string' || specifier.length === 0) throw new Error('ELECTRON_MBT_INVALID_REQUIRE');\n" +
  "      if (has(builtins, specifier)) return builtins[specifier];\n" +
  "      if (!has(deps, specifier)) throw new Error('ELECTRON_MBT_MODULE_DEPENDENCY:' + specifier);\n" +
  "      return load(deps[specifier]);\n" +
  "    }\n" +
  "    localRequire.resolve = function () { throw new Error('ELECTRON_MBT_UNSUPPORTED_API:require.resolve'); };\n" +
  "    module.require = localRequire;\n" +
  "    if (record.json) {\n" +
  "      module.exports = JSON.parse(record.source);\n" +
  "    } else {\n" +
  "      const dirname = id.indexOf('/') >= 0 ? id.slice(0, id.lastIndexOf('/')) : '';\n" +
  "      const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', record.source + '\\n//# sourceURL=' + id);\n" +
  "      wrapper.call(module.exports, module.exports, localRequire, module, id, dirname);\n" +
  "    }\n" +
  "    module.loaded = true;\n" +
  "    return module.exports;\n" +
  "  }\n" +
  "  const value = load(entry);\n" +
  "  return { exports: value, cacheCount: Object.keys(cache).length, cacheIds: Object.keys(cache) };\n" +
  "})()"
}

///|
fn cjs_eval_graph(
  context : Context,
  modules : Array[ModuleSource],
  entry : String,
  prelude : String,
  config_json : String,
) -> CjsResult {
  let registry = @modules.ModuleRegistry::new(4096)
  let mut total = 0
  for mod in modules {
    total += mod.source.length()
    let kind = if mod.json {
      @modules.Json
    } else {
      @modules.CommonJs
    }
    match registry.register(mod.id, mod.source_hash, kind, mod.dependencies) {
      Ok(_) => ()
      Err(error) =>
        if error == @modules.DuplicateModule || error == @modules.InvalidModule {
          return cjs_error("ELECTRON_MBT_MODULE_ID")
        } else if error == @modules.LimitExceeded {
          return cjs_error("ELECTRON_MBT_MODULE_LIMIT")
        } else {
          return cjs_error("ELECTRON_MBT_MODULE_ID")
        }
    }
  }
  if total > 4194304 {
    return cjs_error("ELECTRON_MBT_MODULE_LIMIT")
  }
  for mod in modules {
    for specifier, _ in mod.dependencies {
      match registry.resolve(mod.id, specifier) {
        Ok(_) => ()
        Err(_) => return cjs_error("ELECTRON_MBT_MODULE_DEPENDENCY")
      }
    }
  }
  match registry.state(entry) {
    Ok(_) => ()
    Err(_) => return cjs_error("ELECTRON_MBT_MODULE_NOT_FOUND")
  }
  let graph : Map[String, Json] = {}
  for mod in modules {
    let deps : Map[String, Json] = {}
    for specifier, target in mod.dependencies {
      deps[specifier] = Json(target)
    }
    graph[mod.id] = {
      "source": Json(mod.source),
      "deps": Json(deps),
      "json": Json(mod.json),
    }
  }
  let config_prefix = if config_json.length() > 0 {
    "globalThis.__mbt_config = " + config_json + ";\n"
  } else {
    ""
  }
  let prelude_prefix = if prelude.length() > 0 {
    prelude + "\n"
  } else {
    ""
  }
  let script = config_prefix +
    prelude_prefix +
    "globalThis.__mbt_cjs_graph = " +
    Json(graph).stringify() +
    ";\nglobalThis.__mbt_cjs_entry = " +
    Json(entry).stringify() +
    ";\n" +
    cjs_bootstrap()
  let result = context.eval_script(script, "<cjs-loader>")
  if result.status is Exception {
    {
      status: Exception,
      exports: result.text,
      cache_count: 0,
      cache_ids: [],
    }
  } else {
    let parsed = @json.parse(result.text) catch {
      _ => return cjs_error("ELECTRON_MBT_MODULE_RESULT")
    }
    {
      status: Value,
      exports: cjs_field(parsed, "exports").stringify(),
      cache_count: cjs_int(parsed, "cacheCount"),
      cache_ids: cjs_texts(cjs_field(parsed, "cacheIds")),
    }
  }
}

///|
// Execute a pre-resolved in-memory CJS graph. MoonBit has already admitted
// module IDs, source sizes and dependency targets; the JS leaf owns only
// module.exports and realm-local cache identity.
pub fn Context::eval_cjs(
  self : Context,
  modules : Array[ModuleSource],
  entry : String,
) -> CjsResult {
  cjs_eval_graph(self, modules, entry, "", "")
}

///|
// Install a runtime-owned Node/Electron prelude before the CJS graph. The
// prelude is JS leaf glue for realm identity; it is not a second module
// cache, lifecycle or request ledger.
pub fn Context::eval_cjs_with_prelude(
  self : Context,
  modules : Array[ModuleSource],
  entry : String,
  prelude : String,
  config_json : String,
) -> CjsResult {
  cjs_eval_graph(self, modules, entry, prelude, config_json)
}
