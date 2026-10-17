///|
pub struct ModuleSource {
  id : String
  source_hash : String
  source : String
  dependencies : Map[String, String]
  json : Bool
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
  "globalThis.__mbt_cjs_entry = " +
  "globalThis.__mbt_cjs_entry || null;\n" +
  "(function () {\n" +
  "  const graph = globalThis.__mbt_cjs_graph;\n" +
  "  const entry = globalThis.__mbt_cjs_entry;\n" +
  "  const cache = Object.create(null);\n" +
  "  function load(id) {\n" +
  "    if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id].exports;\n" +
  "    const record = Object.prototype.hasOwnProperty.call(graph, id) ? graph[id] : null;\n" +
  "    if (!record) throw new Error('ELECTRON_MBT_MODULE_NOT_FOUND:' + id);\n" +
  "    const module = { exports: {} };\n" +
  "    cache[id] = module;\n" +
  "    const deps = record.deps || {};\n" +
  "    function localRequire(specifier) {\n" +
  "      if (!Object.prototype.hasOwnProperty.call(deps, specifier)) throw new Error('ELECTRON_MBT_MODULE_DEPENDENCY:' + specifier);\n" +
  "      return load(deps[specifier]);\n" +
  "    }\n" +
  "    if (record.json) {\n" +
  "      module.exports = JSON.parse(record.source);\n" +
  "    } else {\n" +
  "      const wrapper = new Function('exports', 'require', 'module', record.source + '\\n//# sourceURL=' + id);\n" +
  "      wrapper(module.exports, localRequire, module);\n" +
  "    }\n" +
  "    return module.exports;\n" +
  "  }\n" +
  "  const value = load(entry);\n" +
  "  return { exports: value, cacheCount: Object.keys(cache).length, cacheIds: Object.keys(cache) };\n" +
  "})()"
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
  let script = "globalThis.__mbt_cjs_graph = " +
    Json(graph).stringify() +
    ";\nglobalThis.__mbt_cjs_entry = " +
    Json(entry).stringify() +
    ";\n" +
    cjs_bootstrap()
  let result = self.eval_script(script, "<cjs-loader>")
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
