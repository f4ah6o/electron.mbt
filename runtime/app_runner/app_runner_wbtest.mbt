///|
fn ar_hash(path : String) -> String {
  // Deterministic test-only hash value; the runtime compares manifest and
  // supplied hashes, it does not implement SHA-256 itself.
  "sha256:" + path
}

///|
fn ar_manifest(entry : String, files : Array[(String, String)]) -> String {
  let items : Array[Json] = []
  for file in files {
    let (path, source) = file
    items.push(Json({
      "path": Json(path),
      "sha256": Json(ar_hash(path)),
      "bytes": Json(source.length()),
    }))
  }
  Json({
    "schema": Json(2),
    "app": Json("nodeless-fixture"),
    "entry": Json(entry),
    "files": Json(items),
  }).stringify()
}

///|
fn ar_sources(files : Array[(String, String)]) -> Map[String, String] {
  let out : Map[String, String] = {}
  for file in files {
    let (path, source) = file
    out[path] = source
  }
  out
}

///|
fn ar_hashes(files : Array[(String, String)]) -> Map[String, String] {
  let out : Map[String, String] = {}
  for file in files {
    let (path, _) = file
    out[path] = ar_hash(path)
  }
  out
}

///|
fn ar_config() -> AppConfig {
  {
    name: "nodeless-fixture",
    version: "1.0.0",
    app_path: "/app",
    user_data: "/app/userData",
    app_data: "/app/appData",
    resources_path: "/app",
    platform: "darwin",
    arch: "arm64",
    cwd: "/app",
    env: {},
    adapted_adapter: "",
  }
}

///|
fn ar_snapshot(files : Array[(String, String)]) -> SourceSnapshot raise {
  let manifest = ar_manifest("src/main.js", files)
  match SourceSnapshot::from_manifest(manifest, ar_sources(files), ar_hashes(files)) {
    Ok(value) => value
    Err(error) => fail(error.message())
  }
}

///|
test "source manifest admits hashes, entry and relative paths" {
  let files = [
    ("src/main.js", "module.exports = { value: 1 };\n"),
    ("src/lib/a.js", "module.exports = { value: 2 };\n"),
  ]
  let snapshot = ar_snapshot(files)
  assert_eq(snapshot.entry, "src/main.js")
  assert_eq(snapshot.files.length(), 2)
}

///|
test "binary assets are admitted without string sources" {
  let files = [
    ("src/main.js", "module.exports = 1;\n"),
    ("assets/logo.bin", "abcd"),
  ]
  let manifest = ar_manifest("src/main.js", files)
  let sources : Map[String, String] = { "src/main.js": "module.exports = 1;\n" }
  let binary_files : Map[String, Bool] = { "assets/logo.bin": true }
  match SourceSnapshot::from_manifest(manifest, sources, ar_hashes(files), binary_files~) {
    Ok(snapshot) => {
      assert_eq(snapshot.files.length(), 2)
      assert_eq(snapshot.files["assets/logo.bin"].source, "")
      assert_eq(snapshot.files["assets/logo.bin"].bytes, 4)
    }
    Err(error) => fail(error.message())
  }
}

///|
test "source manifest rejects a hash mismatch and an escaping path" {
  let files = [("src/main.js", "module.exports = 1;\n")]
  let manifest = ar_manifest("src/main.js", files)
  let hashes : Map[String, String] = { "src/main.js": "sha256:wrong" }
  let mismatch = SourceSnapshot::from_manifest(manifest, ar_sources(files), hashes)
  assert_true(mismatch is Err(SourceHash(_)))
  let bad_files = [("../escape.js", "module.exports = 1;\n")]
  let bad_manifest = ar_manifest("../escape.js", bad_files)
  let bad = SourceSnapshot::from_manifest(
    bad_manifest, ar_sources(bad_files), ar_hashes(bad_files),
  )
  assert_true(bad is Err(Manifest(_)))
}

///|
test "literal require scanner skips comments and strings" {
  let (plain, dynamic) = scan_requires(
    "// require('no')\nconst a = require('./a'); const s = \"require('./no')\";\n",
  )
  assert_eq(dynamic, false)
  assert_eq(plain.length(), 1)
  assert_eq(plain[0], "./a")
  let (_, computed) = scan_requires("const name = './a'; require(name);")
  assert_eq(computed, true)
}

///|
test "app runner loads a CJS graph and dispatches sync and async handlers" {
  let main =
    "const { app, ipcMain } = require('electron');\n" +
    "const path = require('node:path');\n" +
    "const a = require('./lib/a');\n" +
    "const aAgain = require('./lib/a');\n" +
    "if (a !== aAgain) throw new Error('cache identity');\n" +
    "app.whenReady().then(function () {\n" +
    "  ipcMain.handle('report', function () { return { value: 7, dep: a.value, joined: path.join('a', 'b') }; });\n" +
    "  ipcMain.handle('async', function () { return new Promise(function (resolve) { setTimeout(function () { resolve({ value: 9 }); }, 1); }); });\n" +
    "});\n"
  let files = [
    ("src/main.js", main),
    ("src/lib/a.js", "exports.value = 2;\n"),
  ]
  let snapshot = ar_snapshot(files)
  let graph = build_graph(snapshot)
  assert_true(graph is Ok(_))
  let runner = AppRunner::new(snapshot, ar_config())
  let loaded = runner.load()
  assert_true(loaded is Ok(_))
  let report = runner.dispatch("report", "{}")
  assert_true(report is Ok(_))
  let report_text = match report {
    Ok(value) => value
    Err(_) => ""
  }
  assert_true(report_text.contains("\"value\":7"))
  assert_true(report_text.contains("\"dep\":2"))
  assert_true(report_text.contains("\"joined\":\"a/b\""))
  let async_result = runner.dispatch("async", "{}")
  assert_true(async_result is Ok(_))
  let async_text = match async_result {
    Ok(value) => value
    Err(_) => ""
  }
  assert_true(async_text.contains("\"value\":9"))
  let unknown = runner.dispatch("missing", "{}")
  assert_true(unknown is Ok(_))
  let unknown_text = match unknown {
    Ok(value) => value
    Err(_) => ""
  }
  assert_true(unknown_text.contains("ELECTRON_MBT_MAIN_UNKNOWN_OPERATION"))
  assert_eq(runner.live_leases(), 0)
  runner.stop()
  assert_true(runner.dispatch("report", "{}") is Err(Stopped))
}

///|
test "app runner rejects computed require and missing modules" {
  let computed = [
    ("src/main.js", "const name = './lib/a'; require(name);\n"),
    ("src/lib/a.js", "exports.value = 1;\n"),
  ]
  let snapshot = ar_snapshot(computed)
  assert_true(build_graph(snapshot) is Err(DynamicRequire(_)))
  let missing = [("src/main.js", "require('./missing');\n")]
  let missing_snapshot = ar_snapshot(missing)
  assert_true(build_graph(missing_snapshot) is Err(ModuleResolve(_, _)))
}

///|
test "an ESM package type is rejected before CJS evaluation" {
  let files = [
    ("package.json", "{\"name\":\"esm-fixture\",\"type\":\"module\"}\n"),
    ("src/main.js", "module.exports = 1;\n"),
  ]
  let snapshot = ar_snapshot(files)
  assert_true(build_graph(snapshot) is Err(Manifest(_)))
}
