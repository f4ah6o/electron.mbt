///|
fn prelude_config() -> String {
  "{\"app\":{\"name\":\"fixture\",\"version\":\"1.0.0\",\"appPath\":\"/app\",\"paths\":{\"userData\":\"/app/userData\"}},\"process\":{\"platform\":\"darwin\",\"arch\":\"arm64\",\"cwd\":\"/app\",\"env\":{},\"argv\":[\"nodeless\"],\"versions\":{\"quickjs\":\"2026-06-04\"}},\"limits\":{\"timers\":4}}"
}

///|
test "node prelude provides bounded builtins and fail-closed modules" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let modules = [
    ModuleSource::new(
      "entry",
      "sha256:entry",
      "const path = require('node:path');\n" +
      "const { Buffer } = require('node:buffer');\n" +
      "const { EventEmitter } = require('node:events');\n" +
      "const fsCode = (function () { try { require('node:fs'); return 'unexpected'; } catch (error) { return error.code; } })();\n" +
      "const emitter = new EventEmitter();\n" +
      "let seen = '';\n" +
      "emitter.once('x', function (value) { seen = value; });\n" +
      "emitter.emit('x', 'yes');\n" +
      "module.exports = {\n" +
      "  join: path.join('a', '..', 'b'),\n" +
      "  absolute: path.isAbsolute('/x'),\n" +
      "  dirname: path.dirname('/a/b/c.txt'),\n" +
      "  resolved: path.resolve('/a', 'b'),\n" +
      "  normalized: path.normalize('/a/../b'),\n" +
      "  b64: Buffer.from('hi').toString('base64'),\n" +
      "  event: seen,\n" +
      "  count: emitter.listenerCount('x'),\n" +
      "  fsCode: fsCode,\n" +
      "};\n",
      {},
      false,
    ),
  ]
  let result = context.eval_cjs_with_prelude(modules, "entry", node_prelude(), prelude_config())
  assert_true(result.status is Value)
  assert_true(result.exports.contains("\"join\":\"b\""))
  assert_true(result.exports.contains("\"absolute\":true"))
  assert_true(result.exports.contains("\"dirname\":\"/a/b\""))
  assert_true(result.exports.contains("\"resolved\":\"/a/b\""))
  assert_true(result.exports.contains("\"normalized\":\"/b\""))
  assert_true(result.exports.contains("\"b64\":\"aGk=\""))
  assert_true(result.exports.contains("\"event\":\"yes\""))
  assert_true(result.exports.contains("\"count\":0"))
  assert_true(result.exports.contains("\"fsCode\":\"ELECTRON_MBT_UNSUPPORTED_BUILTIN\""))
  context.destroy()
  engine.destroy()
}

///|
test "node prelude dispatches sync and async handlers exactly once" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let modules = [
    ModuleSource::new(
      "entry",
      "sha256:entry",
      "const { ipcMain } = require('electron');\n" +
      "ipcMain.handle('sync', function () { return { value: 7 }; });\n" +
      "ipcMain.handle('async', function () { return new Promise(function (resolve) { setTimeout(function () { resolve({ value: 9 }); }, 1); }); });\n",
      {},
      false,
    ),
  ]
  let result = context.eval_cjs_with_prelude(modules, "entry", node_prelude(), prelude_config())
  assert_true(result.status is Value)
  let dispatch = context.get_global("__mbt_dispatch")
  assert_eq(dispatch.kind(), 0)
  let operation = context.new_string("sync")
  let payload = context.new_string("{}")
  let sync = dispatch.call2(operation, payload)
  assert_true(sync.text().contains("ok"))
  assert_true(sync.text().contains("value"))
  assert_true(sync.text().contains("7"))
  let unknownOperation = context.new_string("missing")
  let unknown = dispatch.call2(unknownOperation, payload)
  assert_true(unknown.text().contains("ELECTRON_MBT_MAIN_UNKNOWN_OPERATION"))
  let asyncOperation = context.new_string("async")
  let asyncResult = dispatch.call2(asyncOperation, payload)
  assert_true(asyncResult.text().contains("pending"))
  let syncTimers = context.get_global("__mbt_sync_timers")
  let timers = syncTimers.call()
  assert_true(timers.text().contains("delay"))
  assert_true(timers.text().contains("1"))
  operation.release()
  unknownOperation.release()
  asyncOperation.release()
  payload.release()
  sync.release()
  unknown.release()
  asyncResult.release()
  timers.release()
  syncTimers.release()
  dispatch.release()
  context.destroy()
  engine.destroy()
}

///|
test "undefined lease serializes without a free bug" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let value = context.eval_raw("undefined", "<undefined>")
  assert_eq(value.text(), "undefined")
  value.release()
  context.destroy()
  engine.destroy()
}
