///|
fn cjs_module(
  id : String,
  source : String,
  dependencies : Map[String, String],
  json? : Bool = false,
) -> ModuleSource {
  { id, source_hash: "sha256:" + id, source, dependencies, json }
}

///|
fn cjs_json_field(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn cjs_json_number(value : Json, key : String) -> Int32 {
  match cjs_json_field(value, key) {
    Number(number, ..) => number.to_int()
    _ => -1
  }
}

///|
fn cjs_parse_exports(result : CjsResult) -> Json raise {
  assert_true(result.status is Value)
  @json.parse(result.exports) catch {
    _ => {
      assert_true(false)
      null
    }
  }
}

///|
test "MOD-01 cycles observe the partially initialized exports object" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let modules = [
    cjs_module(
      "a",
      "exports.a = 1; const b = require('b'); exports.b = b.b; exports.sawA = b.sawA;",
      { "b": "b" },
    ),
    cjs_module(
      "b",
      "exports.b = 2; const a = require('a'); exports.sawA = a.a;",
      { "a": "a" },
    ),
  ]
  let result = context.eval_cjs(modules, "a")
  let value = cjs_parse_exports(result)
  assert_eq(cjs_json_number(value, "a"), 1)
  assert_eq(cjs_json_number(value, "b"), 2)
  assert_eq(cjs_json_number(value, "sawA"), 1)
  assert_eq(result.cache_count, 2)
  assert_true(result.cache_ids.contains("a"))
  assert_true(result.cache_ids.contains("b"))
  context.destroy()
  engine.destroy()
}

///|
test "MOD-01 a shared dependency is evaluated once and cache identity is stable" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let modules = [
    cjs_module(
      "a",
      "exports.fromA = require('dep').count; exports.fromB = require('b').fromB;",
      { "dep": "dep", "b": "b" },
    ),
    cjs_module("b", "exports.fromB = require('dep').count;", { "dep": "dep" }),
    cjs_module(
      "dep",
      "globalThis.__cjs_dep_count = (globalThis.__cjs_dep_count || 0) + 1; exports.count = globalThis.__cjs_dep_count;",
      {},
    ),
  ]
  let result = context.eval_cjs(modules, "a")
  let value = cjs_parse_exports(result)
  assert_eq(cjs_json_number(value, "fromA"), 1)
  assert_eq(cjs_json_number(value, "fromB"), 1)
  assert_eq(result.cache_count, 3)
  context.destroy()
  engine.destroy()
}

///|
test "MOD-01 module.exports reassignment and JSON modules are preserved" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let modules = [
    cjs_module("c", "module.exports = { value: 3 };", {}),
    cjs_module("j", "{\"x\":1}", {}, json=true),
  ]
  let replaced = context.eval_cjs(modules, "c")
  assert_eq(cjs_parse_exports(replaced).stringify(), "{\"value\":3}")
  let json_module = context.eval_cjs(modules, "j")
  assert_eq(cjs_parse_exports(json_module).stringify(), "{\"x\":1}")
  context.destroy()
  engine.destroy()
}

///|
test "MOD-03 missing dependencies, missing entries, duplicates and syntax errors fail closed" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let missing = context.eval_cjs(
    [cjs_module("a", "require('missing')", {})], "a",
  )
  assert_true(missing.status is Exception)
  assert_true(missing.exports.contains("ELECTRON_MBT_MODULE_DEPENDENCY"))
  let no_entry = context.eval_cjs([cjs_module("a", "1", {})], "b")
  assert_true(no_entry.exports.contains("ELECTRON_MBT_MODULE_NOT_FOUND"))
  let duplicate = context.eval_cjs(
    [cjs_module("a", "1", {}), cjs_module("a", "2", {})], "a",
  )
  assert_true(duplicate.exports.contains("ELECTRON_MBT_MODULE_ID"))
  let syntax = context.eval_cjs(
    [cjs_module("bad", "this is not javascript", {})], "bad",
  )
  assert_true(syntax.status is Exception)
  assert_true(syntax.exports.contains("SyntaxError"))
  context.destroy()
  engine.destroy()
}
