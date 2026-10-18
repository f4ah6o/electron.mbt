///|
#borrow(root, relative, out)
extern "C" fn nodeless_read_file(
  root : Bytes,
  relative : Bytes,
  out : Bytes,
  capacity : Int,
) -> Int = "moonbit_ebt_nodeless_read_file"

///|
#borrow(root, relative, out)
extern "C" fn nodeless_sha256(
  root : Bytes,
  relative : Bytes,
  out : Bytes,
) -> Int = "moonbit_ebt_nodeless_sha256"

///|
#borrow(out)
extern "C" fn nodeless_platform(out : Bytes, capacity : Int) -> Int = "moonbit_ebt_nodeless_platform"

///|
#borrow(out)
extern "C" fn nodeless_arch(out : Bytes, capacity : Int) -> Int = "moonbit_ebt_nodeless_arch"

///|
#borrow(name, out)
extern "C" fn nodeless_env(name : Bytes, out : Bytes, capacity : Int) -> Int = "moonbit_ebt_nodeless_env"

///|
extern "C" fn nodeless_exit(code : Int) = "moonbit_ebt_nodeless_exit"

///|
#borrow(root)
extern "C" fn nodeless_host_open(root : Bytes) -> Int = "moonbit_ebt_nodeless_host_open"

///|
#borrow(operation, payload, out)
extern "C" fn nodeless_host_query(
  operation : Bytes,
  payload : Bytes,
  out : Bytes,
  capacity : Int,
) -> Int = "moonbit_ebt_nodeless_host_query"

///|
extern "C" fn nodeless_host_shutdown() -> Int = "moonbit_ebt_nodeless_host_shutdown"

///|
extern "C" fn nodeless_host_kill() = "moonbit_ebt_nodeless_host_kill"

///|
extern "C" fn nodeless_host_pid() -> Int = "moonbit_ebt_nodeless_host_pid"

///|
fn cli_field(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn cli_text(value : Json, key : String) -> String? {
  match cli_field(value, key) {
    String(text) => Some(text)
    _ => None
  }
}

///|
fn cli_payload_text(raw : String, field : String) -> String? {
  let parsed = @json.parse(raw) catch {
    _ => return None
  }
  match cli_field(parsed, "payload") {
    Object(values) => match values.get(field) {
      Some(String(text)) => Some(text)
      _ => None
    }
    _ => None
  }
}

///|
fn cli_read_text(root : String, path : String) -> String? {
  let buffer = Bytes::new(16777216)
  let length = nodeless_read_file(
    @utf8.encode(root),
    @utf8.encode(path),
    buffer,
    buffer.length(),
  )
  if length <= 0 {
    None
  } else {
    try {
      Some(@utf8.decode(buffer[:length]))
    } catch {
      _ => None
    }
  }
}

///|
fn cli_sha256(root : String, path : String) -> String? {
  let digest = Bytes::new(32)
  if nodeless_sha256(@utf8.encode(root), @utf8.encode(path), digest) != 32 {
    return None
  }
  let out = StringBuilder::new()
  for i = 0; i < 32; i = i + 1 {
    let byte = digest[i].to_int()
    let high = byte / 16
    let low = byte % 16
    out.write_char((if high < 10 { 48 + high } else { 87 + high }).to_char().unwrap())
    out.write_char((if low < 10 { 48 + low } else { 87 + low }).to_char().unwrap())
  }
  Some(out.to_string())
}

///|
fn cli_platform() -> String {
  let buffer = Bytes::new(64)
  let length = nodeless_platform(buffer, buffer.length())
  if length <= 0 {
    "unknown"
  } else {
    @utf8.decode_lossy(buffer[:length])
  }
}

///|
fn cli_arch() -> String {
  let buffer = Bytes::new(64)
  let length = nodeless_arch(buffer, buffer.length())
  if length <= 0 {
    "unknown"
  } else {
    @utf8.decode_lossy(buffer[:length])
  }
}

///|
fn cli_fixture_env() -> Map[String, String] {
  let out : Map[String, String] = {}
  let buffer = Bytes::new(1024)
  let length = nodeless_env(
    @utf8.encode("NODELESS_FIXTURE_ENV"),
    buffer,
    buffer.length(),
  )
  if length > 0 {
    out["NODELESS_FIXTURE_ENV"] = @utf8.decode_lossy(buffer[:length])
  }
  out
}

///|
fn cli_fail(code : String, message : String) -> Unit {
  println(
    Json({
      "schema": Json(1),
      "probe": Json("nodeless-main-runtime"),
      "status": Json("FAIL"),
      "code": Json(code),
      "message": Json(message),
      "compatible": Json(false),
    }).stringify(),
  )
  nodeless_exit(1)
}

///|
fn cli_dispatch_results(
  runner : @app.AppRunner,
  operations : Array[String],
) -> (Map[String, Json], Bool) {
  let results : Map[String, Json] = {}
  let mut ok = true
  for operation in operations {
    match runner.dispatch(operation, "{}") {
      Ok(text) => {
        let parsed = @json.parse(text) catch {
          _ => Json({ "parseError": Json(text) })
        }
        results[operation] = parsed
      }
      Err(error) => {
        ok = false
        results[operation] = Json({
          "error": Json(error.code()),
          "message": Json(error.message()),
        })
      }
    }
  }
  (results, ok)
}

///|
fn main {
  let args = @env.args()
  if args.length() < 3 || args[1] != "run" {
    println("usage: nodeless run <app-dir> [--selftest] [--json]")
    nodeless_exit(2)
    return
  }
  let app_dir = args[2]
  let window_mode = args.contains("--window")
  let mut module_entry = ""
  for i = 0; i < args.length(); i = i + 1 {
    if args[i] == "--entry" && i + 1 < args.length() {
      module_entry = args[i + 1]
    }
  }
  let manifest = match cli_read_text(app_dir, "source-manifest.json") {
    Some(text) => text
    None => {
      cli_fail("ELECTRON_MBT_NODELESS_MANIFEST", "cannot read source-manifest.json")
      return
    }
  }
  let manifest_json = @json.parse(manifest) catch {
    _ => {
      cli_fail("ELECTRON_MBT_NODELESS_MANIFEST", "invalid source-manifest.json")
      return
    }
  }
  let file_items = match cli_field(manifest_json, "files") {
    Array(values) => values
    _ => {
      cli_fail("ELECTRON_MBT_NODELESS_MANIFEST", "manifest has no file list")
      return
    }
  }
  let sources : Map[String, String] = {}
  let hashes : Map[String, String] = {}
  for item in file_items {
    let path = match cli_text(item, "path") {
      Some(value) => value
      None => {
        cli_fail("ELECTRON_MBT_NODELESS_MANIFEST", "file path missing")
        return
      }
    }
    let source = match cli_read_text(app_dir, path) {
      Some(value) => value
      None => {
        cli_fail("ELECTRON_MBT_NODELESS_SOURCE", "cannot read " + path)
        return
      }
    }
    let hash = match cli_sha256(app_dir, path) {
      Some(value) => value
      None => {
        cli_fail("ELECTRON_MBT_NODELESS_SOURCE", "cannot hash " + path)
        return
      }
    }
    sources[path] = source
    hashes[path] = hash
  }
  let snapshot = match @app.SourceSnapshot::from_manifest(manifest, sources, hashes, module_entry~) {
    Ok(value) => value
    Err(error) => {
      cli_fail(error.code(), error.message())
      return
    }
  }
  let module_count = match @app.build_graph(snapshot) {
    Ok(value) => value.length()
    Err(error) => {
      cli_fail(error.code(), error.message())
      return
    }
  }
  let empty_package : Map[String, Json] = {}
  let package_json = match sources.get("package.json") {
    Some(value) => @json.parse(value) catch { _ => Json(empty_package) }
    None => Json(empty_package)
  }
  let name = match cli_text(package_json, "name") {
    Some(value) => value
    None => "nodeless-app"
  }
  let version = match cli_text(package_json, "version") {
    Some(value) => value
    None => "0.0.0"
  }
  let config : @app.AppConfig = {
    name,
    version,
    app_path: app_dir,
    user_data: app_dir + "/.userData",
    app_data: app_dir + "/.appData",
    resources_path: app_dir,
    platform: cli_platform(),
    arch: cli_arch(),
    cwd: app_dir,
    env: cli_fixture_env(),
  }
  let runner = @app.AppRunner::new(snapshot, config)
  if !window_mode {
    match runner.load() {
      Ok(_) => ()
      Err(error) => {
        runner.stop()
        cli_fail(error.code(), error.message())
        return
      }
    }
  }
  if window_mode {
    let fd = nodeless_host_open(@utf8.encode(app_dir))
    if fd < 0 {
      runner.stop()
      cli_fail("ELECTRON_MBT_NODELESS_HOST", "native host start failed")
      return
    }
    if !runner.install_host_bridge() {
      nodeless_host_kill()
      runner.stop()
      cli_fail("ELECTRON_MBT_NODELESS_HOST", "host bridge install failed")
      return
    }
    match runner.load() {
      Ok(_) => ()
      Err(error) => {
        nodeless_host_kill()
        runner.stop()
        cli_fail(error.code(), error.message())
        return
      }
    }
    let title_buffer = Bytes::new(65536)
    let title_length = nodeless_host_query(
      @utf8.encode("get-web-contents-title"),
      @utf8.encode("{}"),
      title_buffer,
      title_buffer.length(),
    )
    let title_reply = if title_length > 0 {
      @utf8.decode_lossy(title_buffer[:title_length])
    } else {
      ""
    }
    let page_title = match cli_payload_text(title_reply, "title") {
      Some(value) => value
      None => ""
    }
    let main_error = runner.global_text("__mbt_last_error")
    let rejection = runner.last_rejection()
    let host_pid = nodeless_host_pid()
    let shutdown = nodeless_host_shutdown()
    let live = runner.live_leases()
    let manifest_hash = match cli_sha256(app_dir, "source-manifest.json") {
      Some(value) => value
      None => ""
    }
    let report = Json({
      "schema": Json(1),
      "probe": Json("nodeless-window-runtime"),
      "status": Json(if page_title.length() > 0 && shutdown == 0 { "PASS" } else { "FAIL" }),
      "engine": Json("quickjs-2026-06-04"),
      "profile": Json("electron-nodeless-adapted-v1"),
      "strict": Json("blocked"),
      "app": Json({
        "name": Json(name),
        "version": Json(version),
        "entry": Json(snapshot.entry),
        "modules": Json(module_count),
        "manifestSha256": Json(manifest_hash),
      }),
      "windowLoaded": Json(page_title.length() > 0),
      "pageTitle": Json(page_title),
      "mainError": Json(main_error),
      "lastRejection": Json(rejection),
      "hostPid": Json(host_pid),
      "hostShutdown": Json(shutdown == 0),
      "liveLeases": Json(live),
      "nodeProcesses": Json(0),
      "notVerified": Json([
        Json("preload"),
        Json("real-renderer"),
        Json("fs-broker"),
        Json("updater-behavior"),
        Json("strict-contextBridge"),
        Json("asan"),
        Json("external-review"),
      ]),
      "compatible": Json(false),
    })
    runner.stop()
    println(report.stringify())
    if page_title.length() == 0 || shutdown != 0 || live != 0 {
      nodeless_exit(1)
    }
    return
  }
  let operations : Array[String] = [
    "selftest:report",
    "selftest:async",
    "selftest:order",
    "selftest:unsupported",
  ]
  let (results, ok) = cli_dispatch_results(runner, operations)
  let live = runner.live_leases()
  let manifest_hash = match cli_sha256(app_dir, "source-manifest.json") {
    Some(value) => value
    None => ""
  }
  let report = Json({
    "schema": Json(1),
    "probe": Json("nodeless-main-runtime"),
    "status": Json(if ok { "PASS" } else { "FAIL" }),
    "engine": Json("quickjs-2026-06-04"),
    "profile": Json("electron-nodeless-adapted-v1"),
    "strict": Json("blocked"),
    "app": Json({
      "name": Json(name),
      "version": Json(version),
      "entry": Json(snapshot.entry),
      "modules": Json(module_count),
      "manifestSha256": Json(manifest_hash),
    }),
    "results": Json(results),
    "liveLeases": Json(live),
    "nodeProcesses": Json(0),
    "notVerified": Json([
      Json("preload"),
      Json("real-renderer"),
      Json("fs-broker"),
      Json("updater-behavior"),
      Json("strict-contextBridge"),
      Json("asan"),
      Json("external-review"),
    ]),
    "compatible": Json(false),
  })
  runner.stop()
  println(report.stringify())
  if !ok || live != 0 {
    nodeless_exit(1)
  }
}
