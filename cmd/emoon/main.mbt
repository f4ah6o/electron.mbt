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
#borrow(out)
extern "C" fn bundle_default_host(out : Bytes, capacity : Int) -> Int = "moonbit_ebt_bundle_default_host"

///|
#borrow(output, stage, host, name, version, report, error)
extern "C" fn bundle_create(
  output : Bytes,
  stage : Bytes,
  host : Bytes,
  name : Bytes,
  version : Bytes,
  report : Bytes,
  report_capacity : Int,
  error : Bytes,
  error_capacity : Int,
  force : Int,
) -> Int = "moonbit_ebt_bundle_create"

///|
extern "C" fn bundle_embedded() -> Int = "moonbit_ebt_bundle_embedded"

///|
#borrow(root, error)
extern "C" fn bundle_prepare(
  root : Bytes,
  root_capacity : Int,
  error : Bytes,
  error_capacity : Int,
) -> Int = "moonbit_ebt_bundle_prepare"

///|
#borrow(out)
extern "C" fn bundle_info(out : Bytes, capacity : Int) -> Int = "moonbit_ebt_bundle_info"

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
extern "C" fn nodeless_host_identity(out : Bytes, capacity : Int) -> Int = "moonbit_ebt_nodeless_host_identity"

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
/// The staged adapted manifest may admit custom schemes for the native asset
/// broker. A missing manifest is the plain profile and admits none; a present
/// but malformed list must fail before the host or main runs.
fn cli_profile_asset_schemes(
  sources : Map[String, String],
) -> Result[Array[String], String] {
  let raw = match sources.get("nodeless-app.json") {
    Some(value) => value
    None => return Ok([])
  }
  let parsed = @json.parse(raw) catch {
    _ => return Err("invalid nodeless-app.json")
  }
  let value = match parsed {
    Object(fields) => fields.get("assetSchemes").unwrap_or(null)
    _ => null
  }
  match @core.protocol_manifest_asset_schemes(value) {
    Ok(schemes) => Ok(schemes)
    Err(code) => Err(code)
  }
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
fn cli_realpath(path : String) -> String {
  let buffer = Bytes::new(4096)
  let length = nodeless_realpath(@utf8.encode(path), buffer, buffer.length())
  if length <= 0 {
    return ""
  }
  @utf8.decode_lossy(buffer[:length])
}

///|
fn cli_grant_store_has(store : Json, canonical : String, key : String) -> Bool {
  let mut found = false
  match cli_field(store, key) {
    Array(values) => {
      for item in values {
        if cli_text(item, "path") is Some(value) && value == canonical {
          found = true
        }
      }
    }
    _ => ()
  }
  found
}

///|
fn cli_grant_store_count(store : Json, key : String) -> Int {
  match cli_field(store, key) {
    Array(values) => values.length()
    _ => 0
  }
}

///|
fn cli_user_file_path(path : String) -> Bool {
  path.length() > 0 && path.length() <= 4096 && path.has_prefix("/")
}

///|
fn cli_user_file_scenario(
  sources : Map[String, String],
) -> Result[(String, String), String] {
  let raw = match sources.get("nodeless-user-file.json") {
    Some(value) => value
    None => return Err("nodeless-user-file.json is missing")
  }
  let parsed = @json.parse(raw) catch {
    _ => return Err("invalid nodeless-user-file.json")
  }
  let schema = match cli_field(parsed, "schema") {
    Number(number, ..) => number.to_int()
    _ => return Err("missing nodeless-user-file.json schema")
  }
  if schema != 1 {
    return Err("unsupported nodeless-user-file.json schema")
  }
  let read_path = match cli_text(parsed, "readPath") {
    Some(value) if cli_user_file_path(value) => value
    _ => return Err("invalid nodeless-user-file readPath")
  }
  let write_path = match cli_text(parsed, "writePath") {
    Some(value) if cli_user_file_path(value) => value
    _ => return Err("invalid nodeless-user-file writePath")
  }
  Ok((read_path, write_path))
}

///|
fn cli_directory_scenario(
  sources : Map[String, String],
) -> Result[Array[(String, String)], String] {
  let raw = match sources.get("nodeless-directory.json") {
    Some(value) => value
    None => return Err("nodeless-directory.json is missing")
  }
  let parsed = @json.parse(raw) catch {
    _ => return Err("invalid nodeless-directory.json")
  }
  let schema = match cli_field(parsed, "schema") {
    Number(number, ..) => number.to_int()
    _ => return Err("missing nodeless-directory.json schema")
  }
  if schema != 1 {
    return Err("unsupported nodeless-directory.json schema")
  }
  let grant_items : Array[Json] = match cli_field(parsed, "grants") {
    Array(values) => values
    _ => return Err("invalid nodeless-directory.json grants")
  }
  if grant_items.length() == 0 || grant_items.length() > 16 {
    return Err("nodeless-directory.json grant limit exceeded")
  }
  let grants : Array[(String, String)] = []
  for item in grant_items {
    let path = match cli_text(item, "path") {
      Some(value) if cli_user_file_path(value) => value
      _ => return Err("invalid directory grant path")
    }
    let mode = match cli_text(item, "mode") {
      Some(value) if value == "read" || value == "write" || value == "readwrite" => value
      _ => return Err("invalid directory grant mode")
    }
    grants.push((path, mode))
  }
  Ok(grants)
}

///|
fn cli_apply_directory_grants(
  grants : Array[(String, String)],
) -> Result[Int, String] {
  let mut count = 0
  for grant in grants {
    let (path, mode) = grant
    let payload = Json({ "path": Json(path), "mode": Json(mode) }).stringify()
    let reply = match cli_host_payload("grant-main-directory", payload) {
      Some(value) => value
      None => return Err("main directory grant failed")
    }
    if !(cli_field(reply, "granted") is True) {
      return Err("main directory grant was not acknowledged")
    }
    count += 1
  }
  Ok(count)
}

///|
fn cli_main_dialog_scenario(
  sources : Map[String, String],
) -> Result[Array[Json], String] {
  let raw = match sources.get("nodeless-dialog.json") {
    Some(value) => value
    None => return Err("nodeless-dialog.json is missing")
  }
  let parsed = @json.parse(raw) catch {
    _ => return Err("invalid nodeless-dialog.json")
  }
  let schema = match cli_field(parsed, "schema") {
    Number(number, ..) => number.to_int()
    _ => return Err("missing nodeless-dialog.json schema")
  }
  if schema != 1 {
    return Err("unsupported nodeless-dialog.json schema")
  }
  let result_items : Array[Json] = match cli_field(parsed, "results") {
    Array(values) => values
    _ => return Err("invalid nodeless-dialog.json results")
  }
  if result_items.length() == 0 || result_items.length() > 16 {
    return Err("nodeless-dialog.json result limit exceeded")
  }
  let results : Array[Json] = []
  for item in result_items {
    let canceled = match cli_field(item, "canceled") {
      True => true
      False => false
      _ => return Err("invalid nodeless-dialog result canceled")
    }
    let path_items : Array[Json] = match cli_field(item, "paths") {
      Array(values) => values
      _ => return Err("invalid nodeless-dialog result paths")
    }
    // The host enforces the real 16-path selection cap. The test queue may
    // carry an over-limit result so the rejection path is exercised without
    // granting any of the earlier paths.
    if path_items.length() > 64 {
      return Err("nodeless-dialog result path limit exceeded")
    }
    if canceled && path_items.length() > 0 {
      return Err("canceled dialog result must not contain paths")
    }
    if !canceled && path_items.length() == 0 {
      return Err("non-canceled dialog result requires paths")
    }
    let paths : Array[Json] = []
    for value in path_items {
      let path = match value {
        String(text) if cli_user_file_path(text) => text
        _ => return Err("invalid nodeless-dialog result path")
      }
      paths.push(Json(path))
    }
    results.push(Json({ "canceled": Json(canceled), "paths": Json(paths) }))
  }
  Ok(results)
}

///|
fn cli_apply_main_dialog_results(
  results : Array[Json],
) -> Result[Int, String] {
  let payload = Json({ "results": Json(results) }).stringify()
  // moonbit_ebt_nodeless_host_query copies the control payload into a fixed
  // 8 KiB buffer; reject a scenario that cannot fit instead of truncating it.
  if @utf8.encode(payload).length() > 8000 {
    return Err("main dialog scenario exceeds the control payload bound")
  }
  let reply = match cli_host_payload("set-main-dialog-results", payload) {
    Some(value) => value
    None => return Err("main dialog result setup failed")
  }
  if !(cli_field(reply, "set") is True) {
    return Err("main dialog result setup was not acknowledged")
  }
  match cli_field(reply, "count") {
    Number(number, ..) => Ok(number.to_int())
    _ => Err("main dialog result count is missing")
  }
}

///|
fn cli_save_dialog_scenario(
  sources : Map[String, String],
) -> Result[(Array[(String, String)], Array[Json]), String] {
  let raw = match sources.get("nodeless-save-dialog.json") {
    Some(value) => value
    None => return Err("nodeless-save-dialog.json is missing")
  }
  let parsed = @json.parse(raw) catch {
    _ => return Err("invalid nodeless-save-dialog.json")
  }
  let schema = match cli_field(parsed, "schema") {
    Number(number, ..) => number.to_int()
    _ => return Err("missing nodeless-save-dialog.json schema")
  }
  if schema != 1 {
    return Err("unsupported nodeless-save-dialog.json schema")
  }
  let grant_items : Array[Json] = match cli_field(parsed, "grants") {
    Array(values) => values
    Null => []
    _ => return Err("invalid nodeless-save-dialog.json grants")
  }
  if grant_items.length() > 64 {
    return Err("nodeless-save-dialog.json grant limit exceeded")
  }
  let grants : Array[(String, String)] = []
  for item in grant_items {
    let path = match cli_text(item, "path") {
      Some(value) if cli_user_file_path(value) => value
      _ => return Err("invalid nodeless-save-dialog grant path")
    }
    let mode = match cli_text(item, "mode") {
      Some(value) if value == "read" || value == "write" || value == "readwrite" => value
      _ => return Err("invalid nodeless-save-dialog grant mode")
    }
    grants.push((path, mode))
  }
  let result_items : Array[Json] = match cli_field(parsed, "results") {
    Array(values) => values
    _ => return Err("invalid nodeless-save-dialog.json results")
  }
  if result_items.length() == 0 || result_items.length() > 16 {
    return Err("nodeless-save-dialog.json result limit exceeded")
  }
  let results : Array[Json] = []
  for item in result_items {
    let canceled = match cli_field(item, "canceled") {
      True => true
      False => false
      _ => return Err("invalid nodeless-save-dialog result canceled")
    }
    let path = match cli_field(item, "path") {
      String(text) if cli_user_file_path(text) => text
      Null => ""
      _ => return Err("invalid nodeless-save-dialog result path")
    }
    if canceled && path.length() > 0 {
      return Err("canceled save dialog result must not contain a path")
    }
    if !canceled && path.length() == 0 {
      return Err("non-canceled save dialog result requires a path")
    }
    results.push(Json({ "canceled": Json(canceled), "path": Json(path) }))
  }
  Ok((grants, results))
}

///|
fn cli_apply_save_dialog_scenario(
  grants : Array[(String, String)],
  results : Array[Json],
) -> Result[Int, String] {
  for request in grants {
    let (path, mode) = request
    let payload = Json({ "path": Json(path), "mode": Json(mode) }).stringify()
    let reply = match cli_host_payload("grant-main-file", payload) {
      Some(value) => value
      None => return Err("save dialog grant setup failed")
    }
    if !(cli_field(reply, "granted") is True) {
      return Err("save dialog grant setup was not acknowledged")
    }
  }
  let payload = Json({ "results": Json(results) }).stringify()
  // The private control request copies its payload into a fixed 8 KiB buffer;
  // reject a scenario that cannot fit instead of truncating it.
  if @utf8.encode(payload).length() > 8000 {
    return Err("save dialog scenario exceeds the control payload bound")
  }
  let reply = match cli_host_payload("set-main-save-dialog-results", payload) {
    Some(value) => value
    None => return Err("save dialog result setup failed")
  }
  if !(cli_field(reply, "set") is True) {
    return Err("save dialog result setup was not acknowledged")
  }
  match cli_field(reply, "count") {
    Number(number, ..) => Ok(number.to_int())
    _ => Err("save dialog result count is missing")
  }
}

///|
fn cli_apply_user_file_grants(
  scenario : (String, String),
) -> Result[Bool, String] {
  let (read_path, write_path) = scenario
  let requests : Array[(String, String)] = [
    (read_path, "read"),
    (write_path, "readwrite"),
  ]
  for request in requests {
    let (path, mode) = request
    let payload = Json({ "path": Json(path), "mode": Json(mode) }).stringify()
    let reply = match cli_host_payload("grant-main-file", payload) {
      Some(value) => value
      None => return Err("main file grant failed")
    }
    if !(cli_field(reply, "granted") is True) {
      return Err("main file grant was not acknowledged")
    }
  }
  Ok(true)
}

///|
fn cli_host_identity() -> (Int, Int) {
  let buffer = Bytes::new(128)
  let length = nodeless_host_identity(buffer, buffer.length())
  if length <= 0 {
    return (0, 0)
  }
  let text = try {
    @utf8.decode(buffer[:length])
  } catch {
    _ => return (0, 0)
  }
  let parsed = @json.parse(text) catch {
    _ => return (0, 0)
  }
  let window = match cli_field(parsed, "window") {
    Number(number, ..) => number.to_int()
    _ => 0
  }
  let generation = match cli_field(parsed, "generation") {
    Number(number, ..) => number.to_int()
    _ => 0
  }
  (window, generation)
}

///|
fn cli_pump_events(
  runner : @app.AppRunner,
  session : String,
  attempts? : Int = 80,
  idle_limit? : Int = 10,
) -> (Int, Int, Int) {
  let event_buffer = Bytes::new(1048576)
  let reply_buffer = Bytes::new(65536)
  let (identity_window, identity_generation) = cli_host_identity()
  runner.pump_idle()
  let mut handled = 0
  let mut errors = 0
  let mut rejected = 0
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
    let event_operation = cli_text(parsed, "operation").unwrap_or("")
    if event_operation != "app-request" && event_operation != "menu-click" {
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
    if event_window != identity_window || event_generation != identity_generation {
      // The native host stamps the actual window/generation. A page-supplied
      // claim is never an authority source, and a stale document event must
      // not reach Main after a reload.
      rejected += 1
      continue
    }
    let payload = match cli_field(parsed, "payload") {
      Object(values) => values
      _ => continue
    }
    if event_operation == "menu-click" {
      let id = match payload.get("id") {
        Some(Number(number, ..)) => number.to_int()
        _ => -1
      }
      if id <= 0 {
        rejected += 1
        continue
      }
      match runner.menu_click(id) {
        Ok(_) => handled += 1
        Err(_) => errors += 1
      }
      runner.pump_idle()
      continue
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
    runner.pump_idle()
    handled += 1
  }
  (handled, errors, rejected)
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
fn cli_parse_seconds(text : String) -> Int {
  if text.length() == 0 || text.length() > 6 {
    return -1
  }
  let mut value = 0
  for i = 0; i < text.length(); i = i + 1 {
    let code = text[i].to_int()
    if code < 48 || code > 57 {
      return -1
    }
    value = value * 10 + (code - 48)
  }
  value
}

///|
fn cli_hold(
  runner : @app.AppRunner,
  session : String,
  adapted_configured : Bool,
  hold_seconds : Int,
  close_after_ms : Int,
  trigger_export_ui : Bool,
  dispatch_main : String,
  jmd_edit_save : Bool,
  focus_jmd_editor : Bool,
  menu_activate : String,
  menu_activate_role : String,
) -> Unit {
  let mut title = ""
  let mut window_title = ""
  let mut url = ""
  let mut released = !adapted_configured
  let mut host_alive = true
  let mut attempts = 0
  while attempts < 100 {
    let _ = cli_pump_events(runner, session, attempts=4, idle_limit=1)
    if adapted_configured {
      match cli_host_payload("get-adapted-status", "{}") {
        Some(value) => {
          if cli_field(value, "released") is True {
            released = true
          }
        }
        None => host_alive = false
      }
    }
    match cli_host_payload("get-web-contents-title", "{}") {
      Some(value) => {
        match cli_text(value, "title") {
          Some(text) => if text.length() > 0 { title = text }
          None => ()
        }
      }
      None => host_alive = false
    }
    match cli_host_payload("get-window-title", "{}") {
      Some(value) => {
        match cli_text(value, "title") {
          Some(text) => if text.length() > 0 { window_title = text }
          None => ()
        }
      }
      None => host_alive = false
    }
    match cli_host_payload("get-web-contents-url", "{}") {
      Some(value) => {
        match cli_text(value, "url") {
          Some(text) => if text.length() > 0 { url = text }
          None => ()
        }
      }
      None => host_alive = false
    }
    if !host_alive || (title.length() > 0 && released) {
      break
    }
    nodeless_sleep_ms(100)
    attempts = attempts + 1
  }
  let asset_status = if cli_platform() == "linux" {
    cli_host_payload("get-asset-status", "{}").unwrap_or(null)
  } else {
    null
  }
  println(
    Json({
      "schema": Json(1),
      "probe": Json("nodeless-hold"),
      "status": Json("HOLDING"),
      "platform": Json(cli_platform()),
      "profile": Json("electron-nodeless-adapted-v1"),
      "pageTitle": Json(title),
      "windowTitle": Json(window_title),
      "pageURL": Json(url),
      "adapted": Json(adapted_configured),
      "released": Json(released),
      "assets": Json(asset_status),
      "mainError": Json(runner.global_text("__mbt_last_error")),
      "holdSeconds": Json(hold_seconds),
      "hostPid": Json(nodeless_host_pid()),
      "compatible": Json(false),
      "note": Json("Interactive hold only; not a compatibility result."),
    }).stringify(),
  )
  let limit = if hold_seconds > 0 { hold_seconds * 10 } else { -1 }
  let mut ticks = 0
  let mut export_ui_sent = false
  let mut dispatch_main_sent = false
  let mut main_dispatch : Json = null
  let mut renderer_probe : Json = null
  let mut jmd_edit_sent = false
  let mut jmd_save_sent = false
  let mut jmd_edit : Json = null
  let mut jmd_save : Json = null
  let mut jmd_focus : Json = null
  let mut menu_activate_json : Json = null
  let mut menu_activate_sent = false
  let mut menu_role_activate_json : Json = null
  let mut menu_role_activate_sent = false
  let mut menu_events = 0
  let mut reason = "hold-seconds"
  let mut close_sent = false
  while limit < 0 || ticks < limit {
    let _ = cli_pump_events(runner, session, attempts=1, idle_limit=1)
    if trigger_export_ui && !export_ui_sent && ticks >= 80 {
      export_ui_sent = true
      let _ = cli_host_payload("trigger-renderer-export-ui", "{}")
    }
    if dispatch_main.length() > 0 && !dispatch_main_sent && ticks >= 20 {
      dispatch_main_sent = true
      main_dispatch = match runner.dispatch(dispatch_main, "{}") {
        Ok(text) => Json({ "ok": Json(true), "result": Json(text) })
        Err(error) => Json({
          "ok": Json(false),
          "code": Json(error.code()),
          "message": Json(error.message()),
        })
      }
    }
    if jmd_edit_save && !jmd_edit_sent && ticks >= 60 {
      jmd_edit_sent = true
      jmd_edit = cli_host_payload("trigger-jmd-edit", "{}").unwrap_or(Json({ "ok": Json(false) }))
    }
    if focus_jmd_editor && (ticks == 100 || ticks == 160) {
      jmd_focus = cli_host_payload("focus-jmd-editor", "{}").unwrap_or(Json({ "ok": Json(false) }))
    }
    if jmd_edit_save && jmd_edit_sent && !jmd_save_sent && ticks >= 70 {
      jmd_save_sent = true
      jmd_save = match runner.dispatch("test:menu-save", "{}") {
        Ok(text) => Json({ "ok": Json(true), "result": Json(text) })
        Err(error) => Json({
          "ok": Json(false),
          "code": Json(error.code()),
          "message": Json(error.message()),
        })
      }
    }
    if menu_activate.length() > 0 && !menu_activate_sent && ticks >= 60 {
      menu_activate_sent = true
      menu_activate_json = cli_host_payload(
        "activate-menu-item",
        Json({ "label": Json(menu_activate) }).stringify(),
      ).unwrap_or(Json({ "ok": Json(false) }))
    }
    if menu_activate_role.length() > 0 && !menu_role_activate_sent &&
      ticks >= 80 {
      menu_role_activate_sent = true
      menu_role_activate_json = cli_host_payload(
        "activate-menu-item",
        Json({ "label": Json(menu_activate_role) }).stringify(),
      ).unwrap_or(Json({ "ok": Json(false) }))
    }
    if menu_activate.length() > 0 || menu_activate_role.length() > 0 {
      let (menu_handled, _, _) =
        cli_pump_events(runner, session, attempts=1, idle_limit=1)
      menu_events = menu_events + menu_handled
    }
    if cli_platform() == "linux" && ticks >= 95 && ticks % 5 == 0 {
      match cli_host_payload("probe-renderer", "{}") {
        Some(value) => renderer_probe = value
        None => ()
      }
    }
    if close_after_ms > 0 && !close_sent && ticks >= close_after_ms / 100 {
      close_sent = true
      let _ = cli_host_payload("simulate-window-close", "{}")
    }
    let mut open = true
    match cli_host_payload("get-window-state", "{}") {
      Some(value) =>
        if cli_field(value, "open") is False {
          open = false
          reason = "window-closed"
        }
      None => {
        // The macOS host predates get-window-state. Fall back to the title
        // query for liveness so hold mode remains platform-neutral; Linux
        // still gets the precise window-closed reason.
        match cli_host_payload("get-web-contents-title", "{}") {
          Some(_) => ()
          None => {
            open = false
            reason = "host-lost"
          }
        }
      }
    }
    if !open {
      break
    }
    nodeless_sleep_ms(50)
    runner.pump_idle()
    ticks = ticks + 1
  }
  match cli_host_payload("get-web-contents-title", "{}") {
    Some(value) => {
      match cli_text(value, "title") {
        Some(text) => if text.length() > 0 { title = text }
        None => ()
      }
    }
    None => ()
  }
  match cli_host_payload("get-window-title", "{}") {
    Some(value) => {
      match cli_text(value, "title") {
        Some(text) => if text.length() > 0 { window_title = text }
        None => ()
      }
    }
    None => ()
  }
  let zoom_level_exit = if cli_platform() == "linux" {
    match cli_host_payload("get-zoom-level", "{}") {
      Some(value) => {
        match cli_field(value, "zoomLevel") {
          Number(number, ..) => Json(number)
          _ => null
        }
      }
      None => null
    }
  } else {
    null
  }
  runner.stop()
  let asset_status_exit = if cli_platform() == "linux" {
    cli_host_payload("get-asset-status", "{}").unwrap_or(null)
  } else {
    null
  }
  let _ = nodeless_host_shutdown()
  println(
    Json({
      "schema": Json(1),
      "probe": Json("nodeless-hold"),
      "status": Json("HOLD_EXIT"),
      "reason": Json(reason),
      "ticks": Json(ticks),
      "pageTitle": Json(title),
      "windowTitle": Json(window_title),
      "pageURL": Json(url),
      "assets": Json(asset_status_exit),
      "rendererProbe": Json(renderer_probe),
      "mainDispatch": Json(main_dispatch),
      "jmdEdit": Json(jmd_edit),
      "jmdSave": Json(jmd_save),
      "jmdFocus": Json(jmd_focus),
      "menuActivate": Json(menu_activate_json),
      "menuRoleActivate": Json(menu_role_activate_json),
      "menuEvents": Json(menu_events),
      "zoomLevel": Json(zoom_level_exit),
      "compatible": Json(false),
    }).stringify(),
  )
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
  let test_box = Bytes::new(8)
  let test_box_length = nodeless_env(
    @utf8.encode("ELECTRON_MBT_TEST_MESSAGE_BOX"),
    test_box,
    test_box.length(),
  )
  if test_box_length > 0 {
    out["ELECTRON_MBT_TEST_MESSAGE_BOX"] = @utf8.decode_lossy(test_box[:test_box_length])
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
///|
fn cli_product_name() -> String { "electromoon" }

///|
fn cli_command_name() -> String { "emoon" }

///|
fn cli_product_version() -> String { "0.1.0" }

///|
fn cli_print_help() -> Unit {
  println("usage: emoon <command> [app-dir] [options]")
  println("")
  println("package an app:")
  println("  bundle [app-dir]  stage if needed, then write one native executable")
  println("                    default output: <app-dir>/.emoon/dist/<name>-<version>-<os>-<arch>")
  println("")
  println("develop:")
  println("  init     write .emoon/config.json for an Electron app")
  println("  inspect  report the app tier and blockers without writing a stage")
  println("  migrate  stage the app under .emoon/app and write the migration report")
  println("  dev      init/inspect/migrate, validate with doctor, then run --window (--build runs npm run build)")
  println("  run      run a prepared app (--window, --entry, --profile, --hold, selftests)")
  println("")
  println("  --asset-scheme <s,...>  admit custom schemes for the adapted asset broker")
  println("  doctor   validate a prepared app without launching it")
  println("")
  println("other:")
  println("  version  print the machine-readable version")
  println("  help     print this help")
  println("")
  println("run `emoon bundle --help` for packaging options")
}

///|
/// A read-only hint for the bare `emoon` invocation. It never writes and never
/// changes the exit code; it only makes the next command discoverable when the
/// current directory looks like an Electron app.
fn cli_print_app_hint() -> Unit {
  let root = match fs_realpath(".") {
    Some(value) => value
    None => return
  }
  let text = match cli_read_text(root, "package.json") {
    Some(value) => value
    None => return
  }
  let parsed = @json.parse(text) catch {
    _ => return
  }
  let main = match cli_text(parsed, "main") {
    Some(value) => value
    None => return
  }
  if main == "" {
    return
  }
  let name = match cli_text(parsed, "name") {
    Some(value) => value
    None => "app"
  }
  let version = match cli_text(parsed, "version") {
    Some(value) => value
    None => "0.0.0"
  }
  eprintln(
    "[emoon] detected " + name + " " + version + " in " + root +
    "; next: emoon bundle",
  )
}

///|
fn cli_print_version_json() -> Unit {
  println(
    Json({
      "schema": Json(1),
      "product": Json(cli_product_name()),
      "cli": Json(cli_command_name()),
      "impl": Json("native"),
      "version": Json(cli_product_version()),
      "engine": Json("quickjs-2026-06-04"),
      "compatible": Json(false),
    }).stringify(),
  )
}

///|
fn cli_block(code : String, message : String) -> Unit {
  println(
    Json({
      "schema": Json(1),
      "product": Json(cli_product_name()),
      "status": Json("BLOCKED"),
      "code": Json(code),
      "message": Json(message),
      "compatible": Json(false),
    }).stringify(),
  )
  nodeless_exit(2)
}

///|
///|
fn cli_main(args : Array[String]) -> Unit {
  if args.length() < 2 {
    cli_print_help()
    cli_print_app_hint()
    nodeless_exit(1)
    return
  }
  let command = args[1]
  if command == "help" || command == "--help" {
    cli_print_help()
    return
  }
  if command == "version" {
    cli_print_version_json()
    return
  }
  if command == "--version" {
    println(cli_command_name() + " " + cli_product_version())
    return
  }
  if command == "bundle" {
    let raw : Array[String] = []
    for i = 2; i < args.length(); i = i + 1 {
      raw.push(args[i])
    }
    cli_bundle_command(raw)
    return
  }
  if command == "init" {
    let raw : Array[String] = []
    for i = 2; i < args.length(); i = i + 1 {
      raw.push(args[i])
    }
    let parsed = match @cli.parse_args(raw) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        return
      }
    }
    let root = command_app_dir(parsed.app_dir)
    command_init_with_args(root, parsed)
    return
  }
  if command == "inspect" {
    let raw : Array[String] = []
    for i = 2; i < args.length(); i = i + 1 {
      raw.push(args[i])
    }
    let parsed = match @cli.parse_args(raw) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        return
      }
    }
    let root = command_app_dir(parsed.app_dir)
    let code = command_inspect_with_args(root, parsed)
    nodeless_exit(code)
    return
  }
  if command == "migrate" {
    let raw : Array[String] = []
    for i = 2; i < args.length(); i = i + 1 {
      raw.push(args[i])
    }
    let parsed = match @cli.parse_args(raw) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        return
      }
    }
    let root = command_app_dir(parsed.app_dir)
    let code = command_migrate_with_args(root, parsed)
    nodeless_exit(code)
    return
  }
  if command == "dev" {
    let raw : Array[String] = []
    for i = 2; i < args.length(); i = i + 1 {
      raw.push(args[i])
    }
    let parsed = match @cli.parse_args(raw) {
      Ok(value) => value
      Err(error) => {
        command_error(error)
        return
      }
    }
    let root = command_app_dir(parsed.app_dir)
    let code = command_dev_with_args(root, parsed)
    nodeless_exit(code)
    return
  }
  if command != "run" && command != "doctor" {
    cli_print_help()
    nodeless_exit(1)
    return
  }
  if args.length() < 3 {
    cli_print_help()
    nodeless_exit(1)
    return
  }
  let doctor_mode = command == "doctor"
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
  let hold_mode = args.contains("--hold")
  let mut hold_seconds = 0
  let mut hold_seconds_set = false
  let mut hold_close_after_ms = 0
  let mut hold_close_after_set = false
  let mut dispatch_main = ""
  let jmd_edit_save = args.contains("--jmd-edit-save")
  let focus_jmd_editor = args.contains("--jmd-focus-editor")
  let mut menu_activate = ""
  let mut menu_activate_role = ""
  let run_loop = args.contains("--run-loop")
  let mut run_loop_seconds = 0
  for i = 0; i < args.length(); i = i + 1 {
    if args[i] == "--menu-activate" && i + 1 < args.length() {
      menu_activate = args[i + 1]
    }
    if args[i] == "--menu-activate-role" && i + 1 < args.length() {
      menu_activate_role = args[i + 1]
    }
    if args[i] == "--run-loop-seconds" && i + 1 < args.length() {
      run_loop_seconds = cli_parse_seconds(args[i + 1])
    }
  }
  for i = 0; i < args.length(); i = i + 1 {
    if args[i] == "--hold-seconds" && i + 1 < args.length() {
      hold_seconds_set = true
      hold_seconds = cli_parse_seconds(args[i + 1])
    }
    if args[i] == "--hold-close-after-ms" && i + 1 < args.length() {
      hold_close_after_set = true
      hold_close_after_ms = cli_parse_seconds(args[i + 1])
    }
    if args[i] == "--dispatch-main" && i + 1 < args.length() {
      dispatch_main = args[i + 1]
    }
  }
  let broker_selftest = args.contains("--broker-selftest")
  let fs_selftest = args.contains("--fs-selftest")
  let user_file_selftest = args.contains("--user-file-selftest")
  let directory_selftest = args.contains("--directory-selftest")
  let dialog_selftest = args.contains("--dialog-selftest")
  let save_dialog_selftest = args.contains("--save-dialog-selftest")
  let dialog_ui_selftest = args.contains("--dialog-ui-selftest")
  let ingress_selftest = args.contains("--ingress-selftest")
  let grant_persist_selftest = args.contains("--grant-persist-selftest")
  let grant_revoke_selftest = args.contains("--grant-revoke-selftest")
  let moji_edit_save_selftest = args.contains("--moji-edit-save-selftest")
  let moji_reopen_selftest = args.contains("--moji-reopen-selftest")
  let moji_save_failure_selftest = args.contains("--moji-save-failure-selftest")
  let trigger_export_ui = args.contains("--trigger-export-ui")
  if hold_mode && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--hold requires --window")
    return
  }
  if hold_seconds_set && !hold_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--hold-seconds requires --hold")
    return
  }
  if hold_seconds_set && (hold_seconds < 1 || hold_seconds > 3600) {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--hold-seconds must be 1..3600")
    return
  }
  if hold_close_after_set && !hold_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--hold-close-after-ms requires --hold")
    return
  }
  if hold_close_after_set && (hold_close_after_ms < 1 || hold_close_after_ms > 60000) {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--hold-close-after-ms must be 1..60000")
    return
  }
  if dispatch_main.length() > 128 {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--dispatch-main is too long")
    return
  }
  if dispatch_main.length() > 0 && !hold_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--dispatch-main requires --hold")
    return
  }
  if jmd_edit_save && !hold_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--jmd-edit-save requires --hold")
    return
  }
  if focus_jmd_editor && !hold_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--jmd-focus-editor requires --hold")
    return
  }
  if menu_activate.length() > 128 || menu_activate_role.length() > 128 {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--menu-activate is too long")
    return
  }
  if (menu_activate.length() > 0 || menu_activate_role.length() > 0) &&
    !hold_mode && !run_loop {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--menu-activate requires --hold or --run-loop")
    return
  }
  if run_loop && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--run-loop requires --window")
    return
  }
  if run_loop && hold_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--run-loop is mutually exclusive with --hold")
    return
  }
  if run_loop_seconds < 0 || run_loop_seconds > 3600 {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--run-loop-seconds must be 0..3600")
    return
  }
  if hold_mode && (broker_selftest || fs_selftest || user_file_selftest ||
      directory_selftest || dialog_selftest || save_dialog_selftest ||
      dialog_ui_selftest || ingress_selftest || grant_persist_selftest ||
      grant_revoke_selftest || moji_edit_save_selftest || moji_reopen_selftest ||
      moji_save_failure_selftest) {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--hold is mutually exclusive with selftests")
    return
  }
  if fs_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--fs-selftest requires --window")
    return
  }
  if user_file_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--user-file-selftest requires --window")
    return
  }
  if directory_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--directory-selftest requires --window")
    return
  }
  if dialog_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--dialog-selftest requires --window")
    return
  }
  if save_dialog_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--save-dialog-selftest requires --window")
    return
  }
  if dialog_ui_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--dialog-ui-selftest requires --window")
    return
  }
  if ingress_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--ingress-selftest requires --window")
    return
  }
  if grant_persist_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--grant-persist-selftest requires --window")
    return
  }
  if grant_revoke_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--grant-revoke-selftest requires --window")
    return
  }
  if user_file_selftest && (grant_persist_selftest || grant_revoke_selftest) {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE",
      "--user-file-selftest is mutually exclusive with grant persistence/revocation selftests")
    return
  }
  if grant_persist_selftest && grant_revoke_selftest {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE",
      "--grant-persist-selftest and --grant-revoke-selftest are mutually exclusive")
    return
  }
  if moji_edit_save_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--moji-edit-save-selftest requires --window")
    return
  }
  if moji_reopen_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE", "--moji-reopen-selftest requires --window")
    return
  }
  if moji_save_failure_selftest && !window_mode {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE",
      "--moji-save-failure-selftest requires --window")
    return
  }
  if (moji_edit_save_selftest && (moji_reopen_selftest || moji_save_failure_selftest)) ||
    (moji_reopen_selftest && moji_save_failure_selftest) {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE",
      "Moji edit/save selftests are mutually exclusive")
    return
  }
  if (moji_edit_save_selftest || moji_reopen_selftest || moji_save_failure_selftest) &&
    (broker_selftest || fs_selftest || user_file_selftest || directory_selftest ||
     dialog_selftest || save_dialog_selftest || dialog_ui_selftest ||
     ingress_selftest || grant_persist_selftest || grant_revoke_selftest) {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE",
      "Moji edit/save selftests are mutually exclusive with other selftests")
    return
  }
  if dialog_selftest && dialog_ui_selftest {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE",
      "--dialog-selftest and --dialog-ui-selftest are mutually exclusive")
    return
  }
  if save_dialog_selftest && (dialog_selftest || dialog_ui_selftest) {
    cli_fail("ELECTRON_MBT_NODELESS_USAGE",
      "--save-dialog-selftest is mutually exclusive with --dialog-selftest and --dialog-ui-selftest")
    return
  }
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
  let manifest_entry = match cli_text(manifest_json, "entry") {
    Some(value) => value
    None => ""
  }
  let package_main = match cli_text(package_json, "main") {
    Some(value) => value
    None => ""
  }
  if module_entry == "" && package_main != "" && package_main != manifest_entry {
    module_entry = package_main
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
  let adapted_adapter = match cli_profile_adapter(sources) {
    Ok(value) => value
    Err(message) => {
      cli_fail("ELECTRON_MBT_NODELESS_PROFILE", message)
      return
    }
  }
  let asset_schemes = match cli_profile_asset_schemes(sources) {
    Ok(value) => value
    Err(code) => {
      cli_fail(code, "invalid assetSchemes in nodeless-app.json")
      return
    }
  }
  let mut requested_profile = ""
  for i = 0; i < args.length(); i = i + 1 {
    if args[i] == "--profile" && i + 1 < args.length() {
      requested_profile = args[i + 1]
    }
  }
  if requested_profile != "" {
    if requested_profile == "electron-nodeless-v1" {
      cli_block(
        "ELECTRON_MBT_PROFILE_BLOCKED",
        "the strict electron-nodeless-v1 profile is blocked",
      )
      return
    }
    if requested_profile == "desktop-core-v1" ||
      requested_profile == "moonbit-native-v1" {
      cli_block(
        "ELECTRON_MBT_PROFILE_ENGINE_MISMATCH",
        "the requested profile uses a different engine",
      )
      return
    }
    if requested_profile != "electron-nodeless-adapted-v1" {
      cli_block("ELECTRON_MBT_UNKNOWN_PROFILE", "unknown runtime profile")
      return
    }
    if adapted_adapter == "" {
      cli_fail(
        "ELECTRON_MBT_NODELESS_PROFILE",
        "electron-nodeless-adapted-v1 requires nodeless-app.json",
      )
      return
    }
  }
  if doctor_mode {
    let manifest_hash = match cli_sha256(app_dir, "source-manifest.json") {
      Some(value) => value
      None => ""
    }
    let adapted_json = if adapted_adapter != "" {
      Json({ "adapter": Json(adapted_adapter) })
    } else {
      Json(null)
    }
    println(
      Json({
        "schema": Json(1),
        "product": Json(cli_product_name()),
        "version": Json(cli_product_version()),
        "command": Json("doctor"),
        "status": Json("ready"),
        "compatible": Json(false),
        "engine": Json("quickjs-2026-06-04"),
        "profile": if adapted_adapter != "" {
          Json("electron-nodeless-adapted-v1")
        } else {
          Json(null)
        },
        "source": Json({
          "manifest": Json("source-manifest.json"),
          "manifestSha256": Json(manifest_hash),
          "entry": Json(snapshot.entry),
          "files": Json(snapshot.files.length()),
          "app": Json({ "name": Json(name), "version": Json(version) }),
        }),
        "adapted": adapted_json,
        "blockers": Json([]),
        "note": Json("static admission only; no window, engine execution, or compatibility result"),
      }).stringify(),
    )
    return
  }
  let mut user_file_read_path = ""
  let mut user_file_write_path = ""
  if user_file_selftest || grant_persist_selftest || grant_revoke_selftest {
    match cli_user_file_scenario(sources) {
      Ok((read_path, write_path)) => {
        user_file_read_path = read_path
        user_file_write_path = write_path
      }
      Err(message) => {
        cli_fail("ELECTRON_MBT_NODELESS_USER_FILE", message)
        return
      }
    }
  }
  let mut directory_grants : Array[(String, String)] = []
  if directory_selftest {
    match cli_directory_scenario(sources) {
      Ok(grants) => directory_grants = grants
      Err(message) => {
        cli_fail("ELECTRON_MBT_NODELESS_DIRECTORY", message)
        return
      }
    }
  }
  let mut dialog_results : Array[Json] = []
  if dialog_selftest {
    match cli_main_dialog_scenario(sources) {
      Ok(results) => dialog_results = results
      Err(message) => {
        cli_fail("ELECTRON_MBT_NODELESS_DIALOG", message)
        return
      }
    }
  }
  let mut save_dialog_grants : Array[(String, String)] = []
  let mut save_dialog_results : Array[Json] = []
  if save_dialog_selftest {
    match cli_save_dialog_scenario(sources) {
      Ok((grants, results)) => {
        save_dialog_grants = grants
        save_dialog_results = results
      }
      Err(message) => {
        cli_fail("ELECTRON_MBT_NODELESS_SAVE_DIALOG", message)
        return
      }
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
    asset_schemes,
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
    if asset_schemes.length() > 0 && cli_platform() == "linux" {
      let schemes_json : Array[Json] = []
      for scheme in asset_schemes {
        schemes_json.push(Json(scheme))
      }
      let payload = Json({ "schemes": Json(schemes_json) }).stringify()
      match cli_host_payload("set-asset-schemes", payload) {
        Some(_) => ()
        None => {
          nodeless_host_kill()
          runner.stop()
          cli_fail(
            "ELECTRON_MBT_NODELESS_PROTOCOL",
            "native host rejected the asset scheme list",
          )
          return
        }
      }
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
    if hold_mode {
      cli_hold(runner, session, adapted_configured, hold_seconds, hold_close_after_ms,
               trigger_export_ui, dispatch_main, jmd_edit_save, focus_jmd_editor,
               menu_activate, menu_activate_role)
      return
    }
    let mut adapted_observed = false
    let mut adapted_released = false
    let mut adapted_requests = 0
    let mut adapted_errors = 0
    let mut adapted_rejected = 0
    let mut ingress : Json = null
    let mut broker_configured = false
    let mut broker_grants = 0
    let mut broker_dialogs = 0
    let mut broker_triggered = false
    let mut broker_api_probe : Json = null
    let mut broker_error = ""
    let mut fs_selftest_json : Json = null
    let mut fs_selftest_ok = true
    let mut user_file_selftest_json : Json = null
    let mut user_file_selftest_ok = true
    let mut directory_selftest_json : Json = null
    let mut directory_selftest_ok = true
    let mut dialog_selftest_json : Json = null
    let mut dialog_selftest_ok = true
    let mut dialog_ui_json : Json = null
    let mut dialog_ui_ok = true
    let mut save_dialog_selftest_json : Json = null
    let mut save_dialog_selftest_ok = true
    let mut save_dialog_ui_json : Json = null
    let mut save_dialog_ui_ok = true
    let mut ingress_selftest_json : Json = null
    let mut ingress_selftest_ok = true
    let mut grant_store : Json = null
    let mut grant_persist_json : Json = null
    let mut grant_persist_ok = true
    let mut grant_revoke_json : Json = null
    let mut grant_revoke_ok = true
    let mut moji_scenario : Json = null
    let mut moji_edit_save_json : Json = null
    let mut moji_edit_save_ok = true
    let mut moji_reopen_json : Json = null
    let mut moji_reopen_ok = true
    let mut moji_save_failure_json : Json = null
    let mut moji_save_failure_ok = true
    if user_file_selftest {
      match cli_apply_user_file_grants((user_file_read_path, user_file_write_path)) {
        Ok(_) => ()
        Err(message) => {
          let _ = nodeless_host_shutdown()
          runner.stop()
          cli_fail("ELECTRON_MBT_NODELESS_USER_FILE", message)
          return
        }
      }
    }
    if directory_selftest {
      match cli_apply_directory_grants(directory_grants) {
        Ok(_) => ()
        Err(message) => {
          let _ = nodeless_host_shutdown()
          runner.stop()
          cli_fail("ELECTRON_MBT_NODELESS_DIRECTORY", message)
          return
        }
      }
    }
    if dialog_selftest {
      match cli_apply_main_dialog_results(dialog_results) {
        Ok(_) => ()
        Err(message) => {
          let _ = nodeless_host_shutdown()
          runner.stop()
          cli_fail("ELECTRON_MBT_NODELESS_DIALOG", message)
          return
        }
      }
    }
    if save_dialog_selftest {
      match cli_apply_save_dialog_scenario(save_dialog_grants, save_dialog_results) {
        Ok(_) => ()
        Err(message) => {
          let _ = nodeless_host_shutdown()
          runner.stop()
          cli_fail("ELECTRON_MBT_NODELESS_SAVE_DIALOG", message)
          return
        }
      }
    }
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
        for _attempt = 0; _attempt < 50; _attempt = _attempt + 1 {
          match cli_host_payload("get-adapted-status", "{}") {
            Some(value) => adapted_released = cli_field(value, "released") is True
            None => adapted_released = false
          }
          if adapted_released {
            break
          }
          nodeless_sleep_ms(20)
        }
      }
      let (requests, errors, rejected) = cli_pump_events(runner, session)
      adapted_requests = requests
      adapted_errors = errors
      adapted_rejected = rejected
      ingress = cli_host_payload("get-ingress-status", "{}").unwrap_or(null)
    }
    if run_loop {
      let mut ticks = 0
      let mut menu_sent = false
      let mut menu_json : Json = null
      let mut menu_role_sent = false
      let mut menu_role_json : Json = null
      let mut reason = "run-loop-seconds"
      while run_loop_seconds == 0 || ticks < run_loop_seconds * 10 {
        if menu_activate.length() > 0 && !menu_sent && ticks >= 60 {
          menu_sent = true
          menu_json = cli_host_payload(
            "activate-menu-item",
            Json({ "label": Json(menu_activate) }).stringify(),
          ).unwrap_or(Json({ "ok": Json(false) }))
        }
        if menu_activate_role.length() > 0 && !menu_role_sent && ticks >= 80 {
          menu_role_sent = true
          menu_role_json = cli_host_payload(
            "activate-menu-item",
            Json({ "label": Json(menu_activate_role) }).stringify(),
          ).unwrap_or(Json({ "ok": Json(false) }))
        }
        let _ = cli_pump_events(runner, session, attempts=1, idle_limit=1)
        runner.pump_idle()
        let mut open = true
        match cli_host_payload("get-window-state", "{}") {
          Some(value) =>
            if cli_field(value, "open") is False {
              open = false
              reason = "window-closed"
            }
          None => open = false
        }
        if !open {
          break
        }
        nodeless_sleep_ms(50)
        ticks = ticks + 1
      }
      let mut final_page_title = ""
      match cli_host_payload("get-web-contents-title", "{}") {
        Some(value) => final_page_title = cli_text(value, "title").unwrap_or("")
        None => ()
      }
      let mut final_window_title = ""
      match cli_host_payload("get-window-title", "{}") {
        Some(value) => final_window_title = cli_text(value, "title").unwrap_or("")
        None => ()
      }
      let zoom_level = if cli_platform() == "linux" {
        match cli_host_payload("get-zoom-level", "{}") {
          Some(value) => {
            match cli_field(value, "zoomLevel") {
              Number(number, ..) => Json(number)
              _ => null
            }
          }
          None => null
        }
      } else {
        null
      }
      println(
        Json({
          "schema": Json(1),
          "probe": Json("nodeless-run-loop"),
          "status": Json("RUN_EXIT"),
          "reason": Json(reason),
          "ticks": Json(ticks),
          "pageTitle": Json(final_page_title),
          "windowTitle": Json(final_window_title),
          "menuActivate": Json(menu_json),
          "menuRoleActivate": Json(menu_role_json),
          "zoomLevel": Json(zoom_level),
          "compatible": Json(false),
        }).stringify(),
      )
      let _ = nodeless_host_shutdown()
      runner.stop()
      return
    }
    if ingress_selftest {
      let (identity_window, identity_generation) = cli_host_identity()
      let stale_generation = if identity_generation > 0 {
        identity_generation - 1
      } else {
        0
      }
      let stale_payload = Json({
        "generation": Json(stale_generation),
        "request": Json({
          "request": Json("ingress-stale"),
          "operation": Json("app:ingress-stale"),
          "payload": Json::empty_object(),
        }),
      }).stringify()
      let live_payload = Json({
        "generation": Json(identity_generation),
        "request": Json({
          "request": Json("ingress-live"),
          "operation": Json("app:ingress-live"),
          // The page may claim any window/generation/sender it likes. The pump
          // must use the native event envelope, never these payload fields.
          "payload": Json({
            "window": Json(999),
            "generation": Json(999),
            "sender": Json("forged-page"),
            "origin": Json("https://evil.example"),
          }),
        }),
      }).stringify()
      let stale_injected = cli_host_payload("inject-app-request", stale_payload) != None
      let live_injected = cli_host_payload("inject-app-request", live_payload) != None
      let (handled, errors, rejected) =
        cli_pump_events(runner, session, attempts=10, idle_limit=2)
      ingress_selftest_ok = stale_injected && live_injected &&
        rejected >= 1 && handled >= 1 && errors == 0
      ingress_selftest_json = Json({
        "ok": Json(ingress_selftest_ok),
        "staleInjected": Json(stale_injected),
        "liveInjected": Json(live_injected),
        "handled": Json(handled),
        "errors": Json(errors),
        "rejected": Json(rejected),
        "window": Json(identity_window),
        "generation": Json(identity_generation),
        "staleGeneration": Json(stale_generation),
        "forgedClaimsIgnored": Json(handled >= 1 && rejected >= 1),
      })
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
    if moji_edit_save_selftest || moji_reopen_selftest || moji_save_failure_selftest {
      let phase = if moji_edit_save_selftest {
        "edit-save"
      } else if moji_reopen_selftest {
        "reopen-save"
      } else {
        "save-failure"
      }
      let mut scenario_error = ""
      let mut triggered = false
      let mut probe : Json = null
      let mut moji_requests = 0
      let mut moji_errors = 0
      let mut moji_rejected = 0
      if !adapted_configured {
        scenario_error = "Moji edit/save selftest requires an adapted adapter"
      } else {
        match cli_apply_broker_scenario(sources) {
          Ok((grants, dialogs)) => {
            broker_grants = grants
            broker_dialogs = dialogs
          }
          Err(message) => scenario_error = message
        }
      }
      if scenario_error.length() == 0 && (broker_grants != 0 || broker_dialogs != 1) {
        scenario_error = "open-for-edit scenario must use 0 grants and 1 open dialog"
      }
      if scenario_error.length() == 0 {
        let payload = Json({ "phase": Json(phase) }).stringify()
        match cli_host_payload("trigger-renderer-edit-save", payload) {
          Some(value) => triggered = cli_field(value, "started") is True
          None => scenario_error = "renderer edit/save trigger failed"
        }
      }
      if triggered {
        let mut finished = false
        for _attempt = 0; _attempt < 400; _attempt = _attempt + 1 {
          let (handled, errors, rejected) = cli_pump_events(runner, session,
            attempts=2, idle_limit=1)
          moji_requests = moji_requests + handled
          moji_errors = moji_errors + errors
          moji_rejected = moji_rejected + rejected
          match cli_host_payload("probe-renderer", "{}") {
            Some(value) => {
              let title = cli_text(value, "title").unwrap_or("")
              if title.length() > 0 {
                probe_title = title
              }
              let text = cli_text(value, "editSave").unwrap_or("")
              if text.length() > 0 {
                probe = @json.parse(text) catch {
                  _ => Json(text)
                }
              }
            }
            None => ()
          }
          let state = cli_text(probe, "state").unwrap_or("")
          if state == "done" || state == "error" {
            finished = true
            break
          }
          nodeless_sleep_ms(50)
        }
        if !finished {
          scenario_error = "renderer edit/save probe timed out"
        }
      }
      let state = cli_text(probe, "state").unwrap_or("")
      if state == "error" && scenario_error.length() == 0 {
        scenario_error = cli_text(probe, "code").unwrap_or("renderer edit/save error")
      }
      adapted_requests = adapted_requests + moji_requests
      adapted_errors = adapted_errors + moji_errors
      adapted_rejected = adapted_rejected + moji_rejected
      let save_error = cli_text(probe, "saveError").unwrap_or("")
      let before_open = cli_text(probe, "beforeOpenSave").unwrap_or("")
      let sibling = cli_text(probe, "siblingSave").unwrap_or("")
      let common_ok = scenario_error.length() == 0 && state == "done" &&
        (cli_field(probe, "open") is True) &&
        (cli_field(probe, "editor") is True) &&
        (cli_field(probe, "inserted") is True) &&
        (cli_field(probe, "dirty") is True) &&
        (cli_field(probe, "saved") is True) && save_error.length() == 0
      if moji_save_failure_selftest {
        let failure_ingress = cli_host_payload("get-ingress-status", "{}").unwrap_or(null)
        let admitted = match cli_field(failure_ingress, "fileSaveAdmitted") {
          Number(number, ..) => number.to_int()
          _ => -1
        }
        let denied = match cli_field(failure_ingress, "fileSaveDenied") {
          Number(number, ..) => number.to_int()
          _ => -1
        }
        let last_code = cli_text(failure_ingress, "lastCode").unwrap_or("")
        let save_failure = cli_text(probe, "saveFailure").unwrap_or("")
        moji_save_failure_ok = scenario_error.length() == 0 && state == "done" &&
          (cli_field(probe, "open") is True) &&
          save_failure == "ELECTRON_MBT_FILE_LINK" &&
          admitted == 0 && denied >= 1 && last_code == "ELECTRON_MBT_FILE_LINK"
        moji_save_failure_json = Json({
          "ok": Json(moji_save_failure_ok),
          "phase": Json(phase),
          "probe": probe,
          "ingress": failure_ingress,
          "error": Json(scenario_error),
        })
      } else if moji_edit_save_selftest {
        moji_edit_save_ok = common_ok &&
          before_open == "ELECTRON_MBT_FILE_DENIED" &&
          sibling == "ELECTRON_MBT_FILE_DENIED"
        moji_edit_save_json = Json({
          "ok": Json(moji_edit_save_ok),
          "phase": Json(phase),
          "probe": probe,
          "error": Json(scenario_error),
        })
      } else {
        moji_reopen_ok = common_ok && (cli_field(probe, "reopenMarkerPresent") is True)
        moji_reopen_json = Json({
          "ok": Json(moji_reopen_ok),
          "phase": Json(phase),
          "probe": probe,
          "error": Json(scenario_error),
        })
      }
      moji_scenario = Json({
        "configured": Json(true),
        "mode": Json("test-injected-open-for-edit"),
        "grants": Json(broker_grants),
        "dialogs": Json(broker_dialogs),
        "triggered": Json(triggered),
        "error": Json(scenario_error),
      })
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
    if fs_selftest {
      let (fs_results, fs_dispatch_ok) = cli_dispatch_results(runner, ["fs:selftest"])
      let fs_dispatch_value = fs_results.get("fs:selftest").unwrap_or(null)
      fs_selftest_json = if cli_field(fs_dispatch_value, "ok") is True {
        cli_field(fs_dispatch_value, "result")
      } else {
        fs_dispatch_value
      }
      fs_selftest_ok = fs_dispatch_ok && (cli_field(fs_selftest_json, "ok") is True)
    }
    if user_file_selftest {
      let (user_results, user_dispatch_ok) = cli_dispatch_results(runner, ["userfile:selftest"])
      let user_dispatch_value = user_results.get("userfile:selftest").unwrap_or(null)
      user_file_selftest_json = if cli_field(user_dispatch_value, "ok") is True {
        cli_field(user_dispatch_value, "result")
      } else {
        user_dispatch_value
      }
      user_file_selftest_ok =
        user_dispatch_ok && (cli_field(user_file_selftest_json, "ok") is True)
    }
    grant_store = cli_host_payload("get-main-grant-store", "{}").unwrap_or(null)
    if grant_persist_selftest {
      let read_canonical = cli_realpath(user_file_read_path)
      let write_canonical = cli_realpath(user_file_write_path)
      let read_granted = cli_grant_store_has(grant_store, read_canonical, "files")
      let write_granted = cli_grant_store_has(grant_store, write_canonical, "files")
      let (user_results, user_dispatch_ok) = cli_dispatch_results(runner, ["userfile:selftest"])
      let user_dispatch_value = user_results.get("userfile:selftest").unwrap_or(null)
      user_file_selftest_json = if cli_field(user_dispatch_value, "ok") is True {
        cli_field(user_dispatch_value, "result")
      } else {
        user_dispatch_value
      }
      user_file_selftest_ok =
        user_dispatch_ok && (cli_field(user_file_selftest_json, "ok") is True)
      grant_persist_ok = read_granted && write_granted && user_file_selftest_ok &&
        (cli_field(grant_store, "loaded") is True) &&
        (cli_field(grant_store, "persisted") is True)
      grant_persist_json = Json({
        "ok": Json(grant_persist_ok),
        "readGranted": Json(read_granted),
        "writeGranted": Json(write_granted),
        "loaded": cli_field(grant_store, "loaded"),
        "persisted": cli_field(grant_store, "persisted"),
        "error": cli_field(grant_store, "error"),
        "userFileSelftestOk": Json(user_file_selftest_ok),
      })
    }
    if grant_revoke_selftest {
      let read_payload = Json({
        "path": Json(user_file_read_path),
        "kind": Json("file"),
      }).stringify()
      let write_payload = Json({
        "path": Json(user_file_write_path),
        "kind": Json("file"),
      }).stringify()
      let revoked_read = match cli_host_payload("revoke-main-grant", read_payload) {
        Some(value) => cli_field(value, "revoked") is True
        None => false
      }
      let revoked_write = match cli_host_payload("revoke-main-grant", write_payload) {
        Some(value) => cli_field(value, "revoked") is True
        None => false
      }
      grant_store = cli_host_payload("get-main-grant-store", "{}").unwrap_or(null)
      let store_empty = cli_grant_store_count(grant_store, "files") == 0 &&
        cli_grant_store_count(grant_store, "directories") == 0
      let read_payload = Json({ "path": Json(user_file_read_path) }).stringify()
      let write_payload = Json({
        "path": Json(user_file_write_path),
        "base64": Json(""),
      }).stringify()
      let read_denied = cli_host_payload("main-read-file", read_payload) == None
      let write_denied = cli_host_payload("main-write-file", write_payload) == None
      grant_revoke_ok = revoked_read && revoked_write && store_empty &&
        read_denied && write_denied
      grant_revoke_json = Json({
        "ok": Json(grant_revoke_ok),
        "revokedRead": Json(revoked_read),
        "revokedWrite": Json(revoked_write),
        "storeEmpty": Json(store_empty),
        "readDenied": Json(read_denied),
        "writeDenied": Json(write_denied),
        "loaded": cli_field(grant_store, "loaded"),
        "persisted": cli_field(grant_store, "persisted"),
        "error": cli_field(grant_store, "error"),
      })
    }
    if directory_selftest {
      let (directory_results, directory_dispatch_ok) =
        cli_dispatch_results(runner, ["directory:selftest"])
      let directory_dispatch_value = directory_results.get("directory:selftest").unwrap_or(null)
      directory_selftest_json = if cli_field(directory_dispatch_value, "ok") is True {
        cli_field(directory_dispatch_value, "result")
      } else {
        directory_dispatch_value
      }
      directory_selftest_ok =
        directory_dispatch_ok && (cli_field(directory_selftest_json, "ok") is True)
    }
    if dialog_selftest {
      let (dialog_results, dialog_dispatch_ok) =
        cli_dispatch_results(runner, ["dialog:selftest"])
      let dialog_dispatch_value = dialog_results.get("dialog:selftest").unwrap_or(null)
      dialog_selftest_json = if cli_field(dialog_dispatch_value, "ok") is True {
        cli_field(dialog_dispatch_value, "result")
      } else {
        dialog_dispatch_value
      }
      dialog_selftest_ok =
        dialog_dispatch_ok && (cli_field(dialog_selftest_json, "ok") is True)
    }
    if save_dialog_selftest {
      let (save_results, save_dispatch_ok) =
        cli_dispatch_results(runner, ["dialog:save-selftest"])
      let save_dispatch_value = save_results.get("dialog:save-selftest").unwrap_or(null)
      save_dialog_selftest_json = if cli_field(save_dispatch_value, "ok") is True {
        cli_field(save_dispatch_value, "result")
      } else {
        save_dispatch_value
      }
      save_dialog_selftest_ok = save_dispatch_ok &&
        (cli_field(save_dialog_selftest_json, "ok") is True)
    }
    if dialog_ui_selftest {
      let (ui_results, ui_dispatch_ok) = cli_dispatch_results(runner, ["dialog:ui-selftest"])
      let ui_dispatch_value = ui_results.get("dialog:ui-selftest").unwrap_or(null)
      dialog_selftest_json = if cli_field(ui_dispatch_value, "ok") is True {
        cli_field(ui_dispatch_value, "result")
      } else {
        ui_dispatch_value
      }
      let (save_ui_results, save_ui_dispatch_ok) =
        cli_dispatch_results(runner, ["dialog:save-ui-selftest"])
      let save_ui_dispatch_value = save_ui_results.get("dialog:save-ui-selftest").unwrap_or(null)
      save_dialog_selftest_json = if cli_field(save_ui_dispatch_value, "ok") is True {
        cli_field(save_ui_dispatch_value, "result")
      } else {
        save_ui_dispatch_value
      }
      dialog_ui_json = cli_host_payload("get-main-dialog-status", "{}").unwrap_or(null)
      save_dialog_ui_json = cli_host_payload("get-main-save-dialog-status", "{}").unwrap_or(null)
      dialog_selftest_ok = ui_dispatch_ok &&
        (cli_field(dialog_selftest_json, "ok") is True) &&
        (cli_field(dialog_selftest_json, "canceled") is True)
      save_dialog_selftest_ok = save_ui_dispatch_ok &&
        (cli_field(save_dialog_selftest_json, "ok") is True) &&
        (cli_field(save_dialog_selftest_json, "canceled") is True)
      dialog_ui_ok = dialog_selftest_ok &&
        (cli_field(dialog_ui_json, "opened") is True) &&
        (cli_field(dialog_ui_json, "completed") is True) &&
        (cli_field(dialog_ui_json, "canceled") is True) &&
        (cli_field(dialog_ui_json, "selection") is False) &&
        save_dialog_selftest_ok &&
        (cli_field(save_dialog_ui_json, "opened") is True) &&
        (cli_field(save_dialog_ui_json, "completed") is True) &&
        (cli_field(save_dialog_ui_json, "canceled") is True) &&
        (cli_field(save_dialog_ui_json, "selection") is False)
      save_dialog_ui_ok = dialog_ui_ok
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
    let document_identity = cli_host_payload("get-document-identity", "{}").unwrap_or(null)
    let document_generation = match cli_field(document_identity, "generation") {
      Number(number, ..) => number.to_int()
      _ => 0
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
    let asset_status = if cli_platform() == "linux" {
      cli_host_payload("get-asset-status", "{}").unwrap_or(null)
    } else {
      null
    }
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
      Json("human-edit-input"),
      Json("production-directory-consent"),
      Json("human-main-dialog-selection"),
      Json("human-main-save-selection"),
      Json("main-save-overwrite-confirmation"),
      Json("main-dialog-sheet-parenting"),
      Json("print-accurate-export"),
      Json("updater-behavior"),
      Json("zlib-stream"),
      Json("ipc-renderer"),
      Json("strict-contextBridge"),
      Json("asan"),
      Json("external-review"),
    ]
    if cli_platform() == "linux" {
      // WebKitGTK's UI-process API does not expose WKScriptMessage.frameInfo,
      // so the native main-frame sender authority remains unproven there.
      not_verified.push(Json("linux-native-sender-frame-authority"))
    }
    if !(grant_persist_ok && (grant_persist_selftest || grant_revoke_selftest)) {
      not_verified.push(Json("grant-persistence"))
    }
    if !renderer_loaded {
      not_verified.push(Json("real-renderer"))
    }
    let status_ok = page_title.length() > 0 && shutdown == 0 && live == 0 &&
      adapted_ok && broker_ok && fs_selftest_ok && user_file_selftest_ok &&
      directory_selftest_ok && dialog_selftest_ok && dialog_ui_ok &&
      save_dialog_selftest_ok && save_dialog_ui_ok && ingress_selftest_ok &&
      grant_persist_ok && grant_revoke_ok && moji_edit_save_ok && moji_reopen_ok &&
      moji_save_failure_ok
    let report = Json({
      "schema": Json(1),
      "probe": Json("nodeless-window-runtime"),
      "status": Json(if status_ok { "PASS" } else { "FAIL" }),
      "engine": Json("quickjs-2026-06-04"),
      "profile": Json("electron-nodeless-adapted-v1"),
      "platform": Json(cli_platform()),
      "arch": Json(cli_arch()),
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
      "documentGeneration": Json(document_generation),
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
        "rejected": Json(adapted_rejected),
        "ingress": ingress,
      }),
      "ingressSelftest": ingress_selftest_json,
      "assets": Json(asset_status),
      "grantStore": grant_store,
      "grantPersistSelftest": grant_persist_json,
      "grantRevokeSelftest": grant_revoke_json,
      "mojiScenario": moji_scenario,
      "mojiEditSave": moji_edit_save_json,
      "mojiEditSaveOk": Json(moji_edit_save_ok),
      "mojiReopen": moji_reopen_json,
      "mojiReopenOk": Json(moji_reopen_ok),
      "mojiSaveFailure": moji_save_failure_json,
      "mojiSaveFailureOk": Json(moji_save_failure_ok),
      "broker": Json({
        "configured": Json(broker_configured),
        "mode": Json("test-injected"),
        "grants": Json(broker_grants),
        "dialogs": Json(broker_dialogs),
        "triggered": Json(broker_triggered),
        "apiProbe": broker_api_probe,
        "error": Json(broker_error),
      }),
      "fsSelftest": fs_selftest_json,
      "fsSelftestOk": Json(fs_selftest_ok),
      "userFileSelftest": user_file_selftest_json,
      "userFileSelftestOk": Json(user_file_selftest_ok),
      "directorySelftest": directory_selftest_json,
      "directorySelftestOk": Json(directory_selftest_ok),
      "dialogSelftest": dialog_selftest_json,
      "dialogSelftestOk": Json(dialog_selftest_ok),
      "dialogUI": dialog_ui_json,
      "dialogUIOk": Json(dialog_ui_ok),
      "saveDialogSelftest": save_dialog_selftest_json,
      "saveDialogSelftestOk": Json(save_dialog_selftest_ok),
      "saveDialogUI": save_dialog_ui_json,
      "saveDialogUIOk": Json(save_dialog_ui_ok),
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

///|
fn cli_bundle_trim_nul(text : String) -> String {
  match text.split_once("\u{0}") {
    Some((head, _)) => head.to_string()
    None => text
  }
}

///|
fn cli_bundle_help() -> Unit {
  println("usage: emoon bundle [--hold] [--hold-seconds N] [--hold-close-after-ms N]")
  println("  no arguments        launch the embedded application")
  println("  --bundle-info      print embedded app/host metadata")
  println("  --version          print the emoon version")
}

///|
fn cli_bundle_embedded(args : Array[String]) -> Bool {
  if bundle_embedded() != 1 {
    return false
  }
  if args.length() >= 2 && args[1] == "--bundle-info" {
    let buffer = Bytes::new(8192)
    let length = bundle_info(buffer, buffer.length())
    if length > 0 {
      println(@utf8.decode_lossy(buffer[:length]))
    } else {
      println(cli_bundle_trim_nul(@utf8.decode_lossy(buffer)))
      nodeless_exit(1)
    }
    return true
  }
  if args.length() >= 2 && args[1] == "--version" {
    cli_print_version_json()
    return true
  }
  if args.length() >= 2 && (args[1] == "--help" || args[1] == "help") {
    cli_bundle_help()
    return true
  }
  let run_args : Array[String] = ["emoon", "run"]
  let root_buffer = Bytes::new(4096)
  let error_buffer = Bytes::new(4096)
  if bundle_prepare(root_buffer, root_buffer.length(), error_buffer, error_buffer.length()) != 0 {
    println(cli_bundle_trim_nul(@utf8.decode_lossy(error_buffer)))
    nodeless_exit(1)
    return true
  }
  let root = cli_bundle_trim_nul(@utf8.decode_lossy(root_buffer))
  run_args.push(root)
  run_args.push("--window")
  let mut index = 1
  while index < args.length() {
    let arg = args[index]
    if arg == "--hold" {
      run_args.push("--hold")
      index = index + 1
    } else if arg == "--hold-close-after-ms" || arg == "--hold-seconds" {
      if index + 1 >= args.length() {
        cli_bundle_help()
        nodeless_exit(1)
        return true
      }
      run_args.push(arg)
      run_args.push(args[index + 1])
      index = index + 2
    } else {
      cli_bundle_help()
      nodeless_exit(1)
      return true
    }
  }
  cli_main(run_args)
  true
}

///|
fn main {
  let args = @env.args()
  if cli_bundle_embedded(args) {
    return
  }
  cli_main(args)
}
