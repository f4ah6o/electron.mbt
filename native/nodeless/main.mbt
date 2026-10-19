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
#borrow(path, out)
extern "C" fn nodeless_realpath(path : Bytes, out : Bytes, capacity : Int) -> Int = "moonbit_ebt_nodeless_realpath"

///|
#borrow(out)
extern "C" fn nodeless_host_session(out : Bytes, capacity : Int) -> Int = "moonbit_ebt_nodeless_host_session"

///|
#borrow(out)
extern "C" fn nodeless_host_next_event(
  out : Bytes,
  capacity : Int,
  timeout_ms : Int,
) -> Int = "moonbit_ebt_nodeless_host_next_event"

///|
extern "C" fn nodeless_sleep_ms(duration_ms : Int) = "moonbit_ebt_nodeless_sleep_ms"

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
fn cli_code_path(path : String) -> Bool {
  path.has_suffix(".js") || path.has_suffix(".cjs") || path.has_suffix(".mjs") ||
  path.has_suffix(".json")
}

///|
fn cli_valid_relative(path : String) -> Bool {
  if path.length() == 0 || path.length() > 256 || path.has_prefix("/") {
    return false
  }
  for part in path.split("/") {
    if part.length() == 0 || part == "." || part == ".." {
      return false
    }
  }
  true
}

///|
fn cli_profile_adapter(
  sources : Map[String, String],
) -> Result[String, String] {
  let raw = match sources.get("nodeless-app.json") {
    Some(value) => value
    None => return Ok("")
  }
  let parsed = @json.parse(raw) catch {
    _ => return Err("invalid nodeless-app.json")
  }
  let schema = match cli_field(parsed, "schema") {
    Number(number, ..) => number.to_int()
    _ => return Err("missing nodeless-app.json schema")
  }
  if schema != 1 {
    return Err("unsupported nodeless-app.json schema")
  }
  let profile = match cli_text(parsed, "profile") {
    Some(value) => value
    None => return Err("missing nodeless-app.json profile")
  }
  if profile != "electron-nodeless-adapted-v1" {
    return Err("unsupported nodeless-app.json profile")
  }
  let adapter = match cli_text(parsed, "adapter") {
    Some(value) => value
    None => return Err("missing nodeless-app.json adapter")
  }
  if !cli_valid_relative(adapter) {
    return Err("invalid adapted adapter path")
  }
  match sources.get(adapter) {
    Some(source) =>
      if @utf8.encode(source).length() > 65536 {
        return Err("adapted adapter exceeds the 64 KiB host limit")
      }
    None => return Err("adapted adapter is not in the source manifest")
  }
  Ok(adapter)
}

///|
fn cli_broker_kind(kind : String) -> Bool {
  kind == "open" || kind == "save" || kind == "export-html" ||
  kind == "export-png" || kind == "export-pdf" || kind == "export-doc-png"
}

///|
fn cli_apply_broker_scenario(
  sources : Map[String, String],
) -> Result[(Int, Int), String] {
  let raw = match sources.get("nodeless-broker.json") {
    Some(value) => value
    None => return Err("nodeless-broker.json is missing")
  }
  let parsed = @json.parse(raw) catch {
    _ => return Err("invalid nodeless-broker.json")
  }
  let schema = match cli_field(parsed, "schema") {
    Number(number, ..) => number.to_int()
    _ => return Err("missing nodeless-broker.json schema")
  }
  if schema != 1 {
    return Err("unsupported nodeless-broker.json schema")
  }
  let grants : Array[Json] = match cli_field(parsed, "grants") {
    Array(values) => values
    Null => []
    _ => return Err("invalid nodeless-broker.json grants")
  }
  let dialogs : Array[Json] = match cli_field(parsed, "dialogs") {
    Array(values) => values
    Null => []
    _ => return Err("invalid nodeless-broker.json dialogs")
  }
  if grants.length() > 16 || dialogs.length() > 16 {
    return Err("nodeless-broker.json entry limit exceeded")
  }
  let mut grant_count = 0
  for item in grants {
    let path = match cli_text(item, "path") {
      Some(value) if cli_valid_relative(value) => value
      _ => return Err("invalid broker grant path")
    }
    let mode = match cli_text(item, "mode") {
      Some(value) if value == "read" || value == "write" || value == "readwrite" => value
      _ => return Err("invalid broker grant mode")
    }
    let payload = Json({ "path": Json(path), "mode": Json(mode) }).stringify()
    let reply = match cli_host_payload("grant-file", payload) {
      Some(value) => value
      None => return Err("broker grant failed")
    }
    if !(cli_field(reply, "granted") is True) {
      return Err("broker grant was not acknowledged")
    }
    grant_count += 1
  }
  let mut dialog_count = 0
  for item in dialogs {
    let kind = match cli_text(item, "kind") {
      Some(value) if cli_broker_kind(value) => value
      _ => return Err("invalid broker dialog kind")
    }
    let path = match cli_text(item, "path") {
      Some(value) if cli_valid_relative(value) => value
      _ => return Err("invalid broker dialog path")
    }
    let payload = Json({ "kind": Json(kind), "path": Json(path) }).stringify()
    let reply = match cli_host_payload("set-dialog-result", payload) {
      Some(value) => value
      None => return Err("broker dialog setup failed")
    }
    if !(cli_field(reply, "set") is True) {
      return Err("broker dialog was not acknowledged")
    }
    dialog_count += 1
  }
  Ok((grant_count, dialog_count))
}

///|
fn cli_pump_events(
  runner : @app.AppRunner,
  session : String,
  attempts? : Int = 80,
  idle_limit? : Int = 10,
) -> (Int, Int) {
  let event_buffer = Bytes::new(65536)
  let reply_buffer = Bytes::new(65536)
  let mut handled = 0
  let mut errors = 0
  let mut idle = 0
  for _attempt = 0; _attempt < attempts; _attempt = _attempt + 1 {
    let length = nodeless_host_next_event(event_buffer, event_buffer.length(), 50)
    if length <= 0 {
      idle += 1
      if (handled > 0 && idle >= idle_limit) || (handled == 0 && idle >= attempts) {
        break
      }
      continue
    }
    idle = 0
    let text = try {
      @utf8.decode(event_buffer[:length])
    } catch {
      _ => continue
    }
    let parsed = @json.parse(text) catch {
      _ => continue
    }
    if !(cli_text(parsed, "session") is Some(value) && value == session) {
      continue
    }
    if !(cli_text(parsed, "operation") is Some("app-request")) {
      continue
    }
    let event_window = match cli_field(parsed, "window") {
      Number(number, ..) => number.to_int()
      _ => -1
    }
    let event_generation = match cli_field(parsed, "generation") {
      Number(number, ..) => number.to_int()
      _ => -1
    }
    if event_window != 1 || event_generation != 1 {
      continue
    }
    let payload = match cli_field(parsed, "payload") {
      Object(values) => values
      _ => continue
    }
    let request = match payload.get("request") {
      Some(String(value)) if value.length() > 0 && value.length() <= 64 => value
      _ => continue
    }
    let operation = match payload.get("operation") {
      Some(String(value)) => value
      _ => continue
    }
    let args = match payload.get("payload") {
      Some(value) => value.stringify()
      None => "null"
    }
    let result = match runner.dispatch(operation, args) {
      Ok(value) => value
      Err(error) =>
        Json({
          "ok": Json(false),
          "code": Json(error.code()),
          "message": Json(error.message()),
        }).stringify()
    }
    let reply = Json({ "request": Json(request), "json": Json(result) }).stringify()
    let sent = nodeless_host_query(
      @utf8.encode("app-reply"),
      @utf8.encode(reply),
      reply_buffer,
      reply_buffer.length(),
    )
    if sent <= 0 {
      errors += 1
    }
    handled += 1
  }
  (handled, errors)
}

///|
fn cli_host_payload(operation : String, payload : String) -> Json? {
  let buffer = Bytes::new(65536)
  let length = nodeless_host_query(
    @utf8.encode(operation),
    @utf8.encode(payload),
    buffer,
    buffer.length(),
  )
  if length <= 0 {
    return None
  }
  let text = try {
    @utf8.decode(buffer[:length])
  } catch {
    _ => return None
  }
  let parsed = @json.parse(text) catch {
    _ => return None
  }
  if !(cli_text(parsed, "terminal") is Some("success")) {
    return None
  }
  Some(cli_field(parsed, "payload"))
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
  let app_dir_buffer = Bytes::new(4096)
  let app_dir_length = nodeless_realpath(
    @utf8.encode(args[2]),
    app_dir_buffer,
    app_dir_buffer.length(),
  )
  if app_dir_length <= 0 {
    cli_fail("ELECTRON_MBT_NODELESS_APP", "cannot resolve the app directory")
    return
  }
  let app_dir = @utf8.decode_lossy(app_dir_buffer[:app_dir_length])
  let window_mode = args.contains("--window")
  let broker_selftest = args.contains("--broker-selftest")
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
  let binary_files : Map[String, Bool] = {}
  for item in file_items {
    let path = match cli_text(item, "path") {
      Some(value) => value
      None => {
        cli_fail("ELECTRON_MBT_NODELESS_MANIFEST", "file path missing")
        return
      }
    }
    let source = cli_read_text(app_dir, path)
    let hash = match cli_sha256(app_dir, path) {
      Some(value) => value
      None => {
        cli_fail("ELECTRON_MBT_NODELESS_SOURCE", "cannot hash " + path)
        return
      }
    }
    match source {
      Some(value) => sources[path] = value
      None =>
        if cli_code_path(path) {
          cli_fail("ELECTRON_MBT_NODELESS_SOURCE", "code source is not valid UTF-8: " + path)
          return
        } else {
          binary_files[path] = true
        }
    }
    hashes[path] = hash
  }
  let snapshot = match @app.SourceSnapshot::from_manifest(
    manifest,
    sources,
    hashes,
    module_entry~,
    binary_files~,
  ) {
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
  let adapted_adapter = match cli_profile_adapter(sources) {
    Ok(value) => value
    Err(message) => {
      cli_fail("ELECTRON_MBT_NODELESS_PROFILE", message)
      return
    }
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
    adapted_adapter,
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
    let session_buffer = Bytes::new(33)
    let session_length = nodeless_host_session(session_buffer, session_buffer.length())
    let session = if session_length > 0 {
      @utf8.decode_lossy(session_buffer[:session_length])
    } else {
      ""
    }
    let adapted_configured = adapted_adapter.length() > 0
    let mut adapted_observed = false
    let mut adapted_released = false
    let mut adapted_requests = 0
    let mut adapted_errors = 0
    let mut ingress : Json = null
    let mut broker_configured = false
    let mut broker_grants = 0
    let mut broker_dialogs = 0
    let mut broker_triggered = false
    let mut broker_api_probe : Json = null
    let mut broker_error = ""
    if adapted_configured {
      for _attempt = 0; _attempt < 50; _attempt = _attempt + 1 {
        match cli_host_payload("get-adapted-status", "{}") {
          Some(value) => adapted_observed = cli_field(value, "observed") is True
          None => adapted_observed = false
        }
        if adapted_observed {
          break
        }
        nodeless_sleep_ms(20)
      }
      if adapted_observed {
        match cli_host_payload("release-adapted-ingress", "{}") {
          Some(value) => adapted_released = cli_field(value, "released") is True
          None => adapted_released = false
        }
      }
      let (requests, errors) = cli_pump_events(runner, session)
      adapted_requests = requests
      adapted_errors = errors
      ingress = cli_host_payload("get-ingress-status", "{}").unwrap_or(null)
    }
    let mut probe_title = ""
    let mut root_children = 0
    let mut api_present = false
    let mut page_text = ""
    for attempt = 0; attempt < 20; attempt = attempt + 1 {
      match cli_host_payload("probe-renderer", "{}") {
        Some(value) => {
          probe_title = cli_text(value, "title").unwrap_or("")
          root_children = match cli_field(value, "rootChildren") {
            Number(number, ..) => number.to_int()
            _ => 0
          }
          api_present = cli_field(value, "api") is True
          page_text = cli_text(value, "text").unwrap_or("")
        }
        None => ()
      }
      if root_children > 0 || attempt == 19 {
        break
      }
      nodeless_sleep_ms(50)
    }
    if broker_selftest {
      broker_configured = true
      if !adapted_configured {
        broker_error = "broker selftest requires an adapted adapter"
      } else {
        match cli_apply_broker_scenario(sources) {
          Ok((grants, dialogs)) => {
            broker_grants = grants
            broker_dialogs = dialogs
          }
          Err(message) => broker_error = message
        }
      }
      if broker_error.length() == 0 {
        match cli_host_payload("trigger-renderer-api", "{}") {
          Some(value) => broker_triggered = cli_field(value, "started") is True
          None => broker_error = "renderer API trigger failed"
        }
      }
      if broker_triggered {
        let mut finished = false
        for _attempt = 0; _attempt < 200; _attempt = _attempt + 1 {
          let _ = cli_pump_events(runner, session, attempts=2, idle_limit=1)
          match cli_host_payload("probe-renderer", "{}") {
            Some(value) => {
              let api_text = cli_text(value, "apiProbe").unwrap_or("")
              if api_text.length() > 0 {
                broker_api_probe = @json.parse(api_text) catch {
                  _ => Json(api_text)
                }
              }
            }
            None => ()
          }
          let state = cli_text(broker_api_probe, "state").unwrap_or("")
          if state == "done" {
            finished = true
            break
          }
          if state == "error" {
            broker_error =
              cli_text(broker_api_probe, "code").unwrap_or("renderer API probe error")
            finished = true
            break
          }
          nodeless_sleep_ms(50)
        }
        if !finished {
          broker_error = "renderer API probe timed out"
        }
      }
    }
    ingress = cli_host_payload("get-ingress-status", "{}").unwrap_or(null)
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
    let fallback_title = match cli_payload_text(title_reply, "title") {
      Some(value) => value
      None => ""
    }
    let page_title = if probe_title.length() > 0 { probe_title } else { fallback_title }
    let url_buffer = Bytes::new(65536)
    let url_length = nodeless_host_query(
      @utf8.encode("get-web-contents-url"),
      @utf8.encode("{}"),
      url_buffer,
      url_buffer.length(),
    )
    let url_reply = if url_length > 0 {
      @utf8.decode_lossy(url_buffer[:url_length])
    } else {
      ""
    }
    let page_url = match cli_payload_text(url_reply, "url") {
      Some(value) => value
      None => ""
    }
    let renderer_loaded = (root_children > 0 || page_text.length() > 0) && api_present
    let adapted_ok = !adapted_configured ||
      (adapted_observed && adapted_released && adapted_requests > 0 &&
       adapted_errors == 0 && renderer_loaded)
    let broker_ok = !broker_configured ||
      (broker_error.length() == 0 && broker_triggered &&
       cli_text(broker_api_probe, "state") is Some("done"))
    let main_error = runner.global_text("__mbt_last_error")
    let rejection = runner.last_rejection()
    let host_pid = nodeless_host_pid()
    let shutdown = nodeless_host_shutdown()
    let live = runner.live_leases()
    let manifest_hash = match cli_sha256(app_dir, "source-manifest.json") {
      Some(value) => value
      None => ""
    }
    let not_verified : Array[Json] = [
      Json("preload"),
      Json("production-file-grants"),
      Json("human-dialog-ui"),
      Json("print-accurate-export"),
      Json("updater-behavior"),
      Json("zlib-stream"),
      Json("ipc-renderer"),
      Json("strict-contextBridge"),
      Json("asan"),
      Json("external-review"),
    ]
    if !renderer_loaded {
      not_verified.push(Json("real-renderer"))
    }
    let status_ok = page_title.length() > 0 && shutdown == 0 && live == 0 &&
      adapted_ok && broker_ok
    let report = Json({
      "schema": Json(1),
      "probe": Json("nodeless-window-runtime"),
      "status": Json(if status_ok { "PASS" } else { "FAIL" }),
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
      "pageURL": Json(page_url),
      "rendererLoaded": Json(renderer_loaded),
      "preloadExecuted": Json(false),
      "renderer": Json({
        "loaded": Json(renderer_loaded),
        "title": Json(page_title),
        "rootChildren": Json(root_children),
        "apiPresent": Json(api_present),
        "text": Json(page_text),
      }),
      "adapted": Json({
        "configured": Json(adapted_configured),
        "adapter": Json(adapted_adapter),
        "observed": Json(adapted_observed),
        "released": Json(adapted_released),
        "requests": Json(adapted_requests),
        "replyErrors": Json(adapted_errors),
        "ingress": ingress,
      }),
      "broker": Json({
        "configured": Json(broker_configured),
        "mode": Json("test-injected"),
        "grants": Json(broker_grants),
        "dialogs": Json(broker_dialogs),
        "triggered": Json(broker_triggered),
        "apiProbe": broker_api_probe,
        "error": Json(broker_error),
      }),
      "mainError": Json(main_error),
      "lastRejection": Json(rejection),
      "hostPid": Json(host_pid),
      "hostShutdown": Json(shutdown == 0),
      "liveLeases": Json(live),
      "nodeProcesses": Json(0),
      "notVerified": Json(not_verified),
      "compatible": Json(false),
    })
    runner.stop()
    println(report.stringify())
    if !status_ok {
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
