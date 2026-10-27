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
      "const fs = require('node:fs');\n" +
      "const { Buffer } = require('node:buffer');\n" +
      "const { EventEmitter } = require('node:events');\n" +
      "const fsCode = (function () { try { fs.readFileSync('/missing'); return 'unexpected'; } catch (error) { return error.code; } })();\n" +
      "const statCode = (function () { try { fs.statSync('/missing'); return 'unexpected'; } catch (error) { return error.code; } })();\n" +
      "const readdirCode = (function () { try { fs.readdirSync('/missing'); return 'unexpected'; } catch (error) { return error.code; } })();\n" +
      "const mkdirCode = (function () { try { fs.mkdirSync('/missing'); return 'unexpected'; } catch (error) { return error.code; } })();\n" +
      "const existsMissing = require('node:fs').existsSync('/missing');\n" +
      "const zlib = require('node:zlib'); const deflate = zlib.createDeflate();\n" +
      "const zlibOk = typeof deflate.write === 'function' && typeof deflate.end === 'function' && typeof deflate[Symbol.asyncIterator] === 'function' && deflate.write(Buffer.from('abc')) === true;\n" +
      "deflate.end();\n" +
      "const intBuf = Buffer.alloc(4); intBuf.writeUInt32BE(0x12345678, 0); const intOk = intBuf.readUInt32BE(0) === 0x12345678;\n" +
      "const sharedAb = new Uint8Array([1, 2, 3]).buffer; const sharedView = Buffer.from(sharedAb); sharedView[0] = 9; const shared = new Uint8Array(sharedAb)[0] === 9;\n" +
      "const updater = require('electron-updater');\n" +
      "const electronMenu = require('electron').Menu;\n" +
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
      "  statCode: statCode,\n" +
      "  readdirCode: readdirCode,\n" +
      "  mkdirCode: mkdirCode,\n" +
      "  existsMissing: existsMissing,\n" +
      "  zlibOk: zlibOk,\n" +
      "  intOk: intOk,\n" +
      "  shared: shared,\n" +
      "  updaterOk: typeof updater.autoUpdater.checkForUpdates === 'function',\n" +
      "  menuOk: typeof electronMenu.buildFromTemplate === 'function',\n" +
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
  assert_true(result.exports.contains("\"fsCode\":\"ELECTRON_MBT_HOST_UNAVAILABLE\""))
  assert_true(result.exports.contains("\"statCode\":\"ELECTRON_MBT_HOST_UNAVAILABLE\""))
  assert_true(result.exports.contains("\"readdirCode\":\"ELECTRON_MBT_HOST_UNAVAILABLE\""))
  assert_true(result.exports.contains("\"mkdirCode\":\"ELECTRON_MBT_HOST_UNAVAILABLE\""))
  assert_true(result.exports.contains("\"existsMissing\":false"))
  assert_true(result.exports.contains("\"zlibOk\":true"))
  assert_true(result.exports.contains("\"intOk\":true"))
  assert_true(result.exports.contains("\"shared\":true"))
  assert_true(result.exports.contains("\"updaterOk\":true"))
  assert_true(result.exports.contains("\"menuOk\":true"))
  context.destroy()
  engine.destroy()
}

///|
test "node crypto provides sha256, uuid, bytes and host entropy" {
  let engine = Engine::new()
  let context = Context::new(engine)
  assert_true(context.install_host_bridge())
  let modules = [
    ModuleSource::new(
      "entry",
      "sha256:crypto",
      "const crypto = require('node:crypto');\n" +
      "const { Buffer } = require('node:buffer');\n" +
      "const empty = crypto.createHash('sha256').digest('hex');\n" +
      "const abc = crypto.createHash('sha256').update('abc').digest('hex');\n" +
      "const b64 = crypto.createHash('sha256').update('abc').digest('base64');\n" +
      "const hashBuffer = Buffer.isBuffer(crypto.createHash('sha256').digest());\n" +
      "const uuid1 = crypto.randomUUID();\n" +
      "const uuid2 = crypto.randomUUID();\n" +
      "const bytes = crypto.randomBytes(8);\n" +
      "const array = new Uint8Array(4);\n" +
      "crypto.getRandomValues(array);\n" +
      "let algorithm = '';\n" +
      "try { crypto.createHash('md5'); } catch (error) { algorithm = error.code; }\n" +
      "module.exports = { empty: empty, abc: abc, b64: b64, hashBuffer: hashBuffer,\n" +
      "  uuidLength: uuid1.length, uuidVersion: uuid1.charAt(14),\n" +
      "  uuidVariant: '89ab'.indexOf(uuid1.charAt(19)) >= 0, uuidDistinct: uuid1 !== uuid2,\n" +
      "  byteLength: bytes.length, isBuffer: Buffer.isBuffer(bytes),\n" +
      "  randomArray: array.length, algorithm: algorithm };\n",
      {},
      false,
    ),
  ]
  let result = context.eval_cjs_with_prelude(modules, "entry", node_prelude(), prelude_config())
  assert_true(result.status is Value)
  assert_true(result.exports.contains("\"empty\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\""))
  assert_true(result.exports.contains("\"abc\":\"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\""))
  assert_true(result.exports.contains("\"b64\":\"ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=\""))
  assert_true(result.exports.contains("\"hashBuffer\":true"))
  assert_true(result.exports.contains("\"uuidLength\":36"))
  assert_true(result.exports.contains("\"uuidVersion\":\"4\""))
  assert_true(result.exports.contains("\"uuidVariant\":true"))
  assert_true(result.exports.contains("\"uuidDistinct\":true"))
  assert_true(result.exports.contains("\"byteLength\":8"))
  assert_true(result.exports.contains("\"isBuffer\":true"))
  assert_true(result.exports.contains("\"randomArray\":4"))
  assert_true(result.exports.contains("\"algorithm\":\"ELECTRON_MBT_UNSUPPORTED_API\""))
  context.destroy()
  engine.destroy()
}

///|
test "node prelude exposes v8, worker_threads, perf_hooks and os surfaces" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let modules = [
    ModuleSource::new(
      "entry",
      "sha256:runtime-surfaces",
      "const v8 = require('node:v8');\n" +
      "const os = require('node:os');\n" +
      "const workerThreads = require('node:worker_threads');\n" +
      "const perf = require('node:perf_hooks').performance;\n" +
      "const fs = require('node:fs');\n" +
      "const controller = new AbortController();\n" +
      "let abortEvents = 0;\n" +
      "controller.signal.addEventListener('abort', function () { abortEvents += 1; });\n" +
      "controller.abort();\n" +
      "const electron = require('electron');\n" +
      "electron.protocol.registerSchemesAsPrivileged([{ scheme: 'protocol-test' }]);\n" +
      "electron.protocol.handle('protocol-test', function () {});\n" +
      "electron.ipcMain.on('listener-test', function (_event, value) { globalThis.__listenerValue = value; });\n" +
      "const listenerReply = JSON.parse(globalThis.__mbt_dispatch('listener-test', JSON.stringify({ args: [7] })));\n" +
      "const readReply = JSON.parse(globalThis.__mbt_dispatch('emoon:read-file', JSON.stringify({ args: ['/missing'] })));\n" +
      "let renameCode = ''; try { fs.renameSync('/a', '/b'); } catch (error) { renameCode = error.code; }\n" +
      "let unlinkCode = ''; try { fs.unlinkSync('/a'); } catch (error) { unlinkCode = error.code; }\n" +
      "perf.mark('a');\n" +
      "perf.mark('b');\n" +
      "perf.measure('m', 'a', 'b');\n" +
      "const entries = perf.getEntriesByName('m', 'measure');\n" +
      "const duration = entries.length > 0 ? entries[entries.length - 1].duration : -1;\n" +
      "perf.clearMeasures('m');\n" +
      "let workerCode = '';\n" +
      "try { new workerThreads.Worker('x'); } catch (error) { workerCode = error.code; }\n" +
      "module.exports = { heap: typeof v8.getHeapStatistics().heap_size_limit,\n" +
      "  platform: os.platform(), cpus: os.cpus().length, totalmem: os.totalmem(),\n" +
      "  isMainThread: workerThreads.isMainThread, workerCode: workerCode,\n" +
      "  durationAtLeastZero: duration >= 0,\n" +
      "  measuresAfter: perf.getEntriesByName('m', 'measure').length,\n" +
      "  globalPerformance: typeof performance.now(),\n" +
      "  protocolHandled: electron.protocol.isProtocolHandled('protocol-test'),\n" +
      "  readCode: readReply.code, renameCode: renameCode, unlinkCode: unlinkCode,\n" +
      "  aborted: controller.signal.aborted, abortEvents: abortEvents,\n" +
      "  listenerOk: listenerReply.ok === true && globalThis.__listenerValue === 7 };\n",
      {},
      false,
    ),
  ]
  let result = context.eval_cjs_with_prelude(modules, "entry", node_prelude(), prelude_config())
  assert_true(result.status is Value)
  assert_true(result.exports.contains("\"heap\":\"number\""))
  assert_true(result.exports.contains("\"platform\":\"darwin\""))
  assert_true(result.exports.contains("\"cpus\":1"))
  assert_true(result.exports.contains("\"totalmem\":0"))
  assert_true(result.exports.contains("\"isMainThread\":true"))
  assert_true(result.exports.contains("\"workerCode\":\"ELECTRON_MBT_UNSUPPORTED_API\""))
  assert_true(result.exports.contains("\"durationAtLeastZero\":true"))
  assert_true(result.exports.contains("\"measuresAfter\":0"))
  assert_true(result.exports.contains("\"globalPerformance\":\"number\""))
  assert_true(result.exports.contains("\"protocolHandled\":true"))
  assert_true(result.exports.contains("\"readCode\":\"ELECTRON_MBT_HOST_UNAVAILABLE\""))
  assert_true(result.exports.contains("\"renameCode\":\"ELECTRON_MBT_HOST_UNAVAILABLE\""))
  assert_true(result.exports.contains("\"unlinkCode\":\"ELECTRON_MBT_HOST_UNAVAILABLE\""))
  assert_true(result.exports.contains("\"aborted\":true"))
  assert_true(result.exports.contains("\"abortEvents\":1"))
  assert_true(result.exports.contains("\"listenerOk\":true"))
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
test "main dialog is bounded and fails closed without a host bridge" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let modules = [
    ModuleSource::new(
      "entry",
      "sha256:entry",
      "const { dialog } = require('electron');\n" +
      "const shape = typeof dialog.showOpenDialog === 'function';\n" +
      "const saveShape = typeof dialog.showSaveDialog === 'function';\n" +
      "let saveSyncCode = 'none';\n" +
      "try { dialog.showSaveDialogSync(); } catch (error) { saveSyncCode = error.code; }\n" +
      "globalThis.__dialogOptionCode = 'pending';\n" +
      "dialog.showOpenDialog({ securityScopedBookmarks: true }).catch(function (error) { globalThis.__dialogOptionCode = error.code; });\n" +
      "globalThis.__dialogHostCode = 'pending';\n" +
      "dialog.showOpenDialog({}).catch(function (error) { globalThis.__dialogHostCode = error.code; });\n" +
      "globalThis.__saveHostCode = 'pending';\n" +
      "dialog.showSaveDialog({}).catch(function (error) { globalThis.__saveHostCode = error.code; });\n" +
      "globalThis.__saveOptionCode = 'pending';\n" +
      "dialog.showSaveDialog({ nameFieldLabel: 'x' }).catch(function (error) { globalThis.__saveOptionCode = error.code; });\n" +
      "globalThis.__savePropertyCode = 'pending';\n" +
      "dialog.showSaveDialog({ properties: ['createDirectory'] }).catch(function (error) { globalThis.__savePropertyCode = error.code; });\n" +
      "globalThis.__savePathCode = 'pending';\n" +
      "dialog.showSaveDialog({ defaultPath: 'dir/file.md' }).catch(function (error) { globalThis.__savePathCode = error.code; });\n" +
      "globalThis.__saveBareCode = 'pending';\n" +
      "dialog.showSaveDialog({ defaultPath: 'note.md' }).catch(function (error) { globalThis.__saveBareCode = error.code; });\n" +
      "module.exports = { shape: shape, saveShape: saveShape, saveSyncCode: saveSyncCode };\n",
      {},
      false,
    ),
  ]
  let result = context.eval_cjs_with_prelude(modules, "entry", node_prelude(), prelude_config())
  assert_true(result.status is Value)
  assert_true(result.exports.contains("\"shape\":true"))
  assert_true(result.exports.contains("\"saveShape\":true"))
  assert_true(result.exports.contains("\"saveSyncCode\":\"ELECTRON_MBT_UNSUPPORTED_API\""))
  let mut jobs = 0
  while engine.job_pending() && jobs < 16 {
    let _ = engine.execute_one_job()
    jobs = jobs + 1
  }
  let optionCode = context.get_global("__dialogOptionCode")
  assert_true(optionCode.text().contains("ELECTRON_MBT_UNSUPPORTED_API"))
  let hostCode = context.get_global("__dialogHostCode")
  assert_true(hostCode.text().contains("ELECTRON_MBT_HOST_UNAVAILABLE"))
  let saveHostCode = context.get_global("__saveHostCode")
  assert_true(saveHostCode.text().contains("ELECTRON_MBT_HOST_UNAVAILABLE"))
  let saveOptionCode = context.get_global("__saveOptionCode")
  assert_true(saveOptionCode.text().contains("ELECTRON_MBT_UNSUPPORTED_API"))
  let savePropertyCode = context.get_global("__savePropertyCode")
  assert_true(savePropertyCode.text().contains("ELECTRON_MBT_UNSUPPORTED_API"))
  let savePathCode = context.get_global("__savePathCode")
  assert_true(savePathCode.text().contains("EINVAL"))
  let saveBareCode = context.get_global("__saveBareCode")
  assert_true(saveBareCode.text().contains("ELECTRON_MBT_HOST_UNAVAILABLE"))
  optionCode.release()
  hostCode.release()
  saveHostCode.release()
  saveOptionCode.release()
  savePropertyCode.release()
  savePathCode.release()
  saveBareCode.release()
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
