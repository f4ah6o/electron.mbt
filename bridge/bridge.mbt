///|
pub fn new_runtime() -> @core.Runtime {
  @core.Runtime::new()
}

///|
fn field(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn text(value : Json, key : String) -> String {
  match field(value, key) {
    String(value) => value
    _ => ""
  }
}

///|
fn code_result(result : Result[Unit, @core.RuntimeError]) -> String {
  match result {
    Ok(_) => "{\"ok\":true}"
    Err(code) => {
      let value : Json = { "ok": false, "code": code.code().to_json() }
      value.stringify()
    }
  }
}

///|
fn arg_int(value : Json, key : String) -> Result[Int32, @core.RuntimeError] {
  match field(value, key) {
    Number(number, ..) => {
      let int = number.to_int()
      // A fractional or out-of-range id must not silently become another handle.
      if int.to_double() == number {
        Ok(int)
      } else {
        Err(InvalidPayload)
      }
    }
    _ => Err(InvalidPayload)
  }
}

///|
fn arg_bool(value : Json, key : String) -> Result[Bool, @core.RuntimeError] {
  match field(value, key) {
    True => Ok(true)
    False => Ok(false)
    _ => Err(InvalidPayload)
  }
}

///|
fn arg_text(value : Json, key : String) -> Result[String, @core.RuntimeError] {
  match field(value, key) {
    String(text) => Ok(text)
    _ => Err(InvalidPayload)
  }
}

///|
fn respond(pairs : Array[(String, Json)]) -> String {
  let fields : Map[String, Json] = { "ok": true }
  for pair in pairs {
    fields[pair.0] = pair.1
  }
  fields.to_json().stringify()
}

///|
fn invalid_payload() -> String {
  "{\"ok\":false,\"code\":\"InvalidPayload\"}"
}

///|
fn window_state_name(state : @core.WindowState) -> String {
  match state {
    Creating => "Creating"
    Live => "Live"
    Closing => "Closing"
  }
}

///|
// Structured envelope ops carry the window/document/request surface through the
// same boundary the app lifecycle ops use, so leaf adapters never re-implement
// core bookkeeping in JavaScript. Missing or mistyped arguments are
// InvalidPayload; extra fields are ignored.
fn dispatch_json(runtime : @core.Runtime, raw : String) -> String {
  if raw.length() > 16384 {
    return invalid_payload()
  }
  let value = @json.parse(raw) catch { _ => return invalid_payload() }
  if text(value, "op").has_prefix("ipc.listeners.") {
    return dispatch_ipc_listeners(runtime, value)
  }
  match text(value, "op") {
    "window.reserve" =>
      match runtime.reserve_window() {
        Ok(id) => respond([("window", id.to_json())])
        Err(error) => code_result(Err(error))
      }
    "window.confirm" =>
      match arg_int(value, "window") {
        Ok(id) => code_result(runtime.confirm_window(id))
        Err(error) => code_result(Err(error))
      }
    "window.state" =>
      match arg_int(value, "window") {
        Ok(id) =>
          match runtime.window_state(id) {
            Ok(state) =>
              respond([("state", window_state_name(state).to_json())])
            Err(error) => code_result(Err(error))
          }
        Err(error) => code_result(Err(error))
      }
    "window.begin-close" =>
      match arg_int(value, "window") {
        Ok(id) => code_result(runtime.begin_close(id))
        Err(error) => code_result(Err(error))
      }
    "window.cancel-close" =>
      match arg_int(value, "window") {
        Ok(id) => code_result(runtime.cancel_close(id))
        Err(error) => code_result(Err(error))
      }
    "window.destroy" =>
      match arg_int(value, "window") {
        Ok(id) => respond([("destroyed", runtime.destroy_window(id).to_json())])
        Err(error) => code_result(Err(error))
      }
    "window.navigate" =>
      match arg_int(value, "window") {
        Ok(id) =>
          match runtime.navigate(id) {
            Ok(generation) => respond([("generation", generation.to_json())])
            Err(error) => code_result(Err(error))
          }
        Err(error) => code_result(Err(error))
      }
    "document.activate" =>
      match
        (
          arg_int(value, "window"),
          arg_int(value, "generation"),
          arg_text(value, "host_origin"),
        ) {
        (Ok(id), Ok(generation), Ok(origin)) =>
          code_result(runtime.activate_document(id, generation, origin))
        _ => invalid_payload()
      }
    "grant" =>
      match
        (
          arg_int(value, "window"),
          arg_int(value, "generation"),
          arg_text(value, "channel"),
        ) {
        (Ok(id), Ok(generation), Ok(channel)) =>
          code_result(runtime.grant(id, generation, channel))
        _ => invalid_payload()
      }
    "authorize" =>
      match
        (
          arg_int(value, "window"),
          arg_int(value, "generation"),
          arg_text(value, "host_origin"),
          arg_bool(value, "main_frame"),
          arg_text(value, "channel"),
        ) {
        (Ok(id), Ok(generation), Ok(origin), Ok(main_frame), Ok(channel)) =>
          code_result(
            runtime.authorize(id, generation, origin, main_frame, channel),
          )
        _ => invalid_payload()
      }
    "request.begin" =>
      match
        (
          arg_int(value, "window"),
          arg_int(value, "generation"),
          arg_text(value, "host_origin"),
          arg_bool(value, "main_frame"),
          arg_text(value, "channel"),
          arg_int(value, "payload_bytes"),
        ) {
        (
          Ok(id),
          Ok(generation),
          Ok(origin),
          Ok(main_frame),
          Ok(channel),
          Ok(bytes),
        ) =>
          match
            runtime.begin_request(
              id, generation, origin, main_frame, channel, bytes,
            ) {
            Ok(request) => respond([("request", request.to_json())])
            Err(error) => code_result(Err(error))
          }
        _ => invalid_payload()
      }
    "request.complete" =>
      match
        (
          arg_int(value, "request"),
          arg_int(value, "window"),
          arg_int(value, "generation"),
        ) {
        (Ok(request), Ok(id), Ok(generation)) =>
          code_result(runtime.complete_request(request, id, generation))
        _ => invalid_payload()
      }
    "pending" => respond([("pending", runtime.pending_count().to_json())])
    "queued-bytes" => respond([("bytes", runtime.queued_bytes().to_json())])
    "cancellations.take" =>
      respond([("cancelled", runtime.take_cancellations().to_json())])
    "preferences.validate" =>
      match
        (
          arg_bool(value, "node_integration"),
          arg_bool(value, "context_isolation"),
          arg_bool(value, "sandbox"),
          arg_bool(value, "web_security"),
        ) {
        (
          Ok(node_integration),
          Ok(context_isolation),
          Ok(sandbox),
          Ok(web_security),
        ) =>
          respond([
            (
              "valid",
              @core.validate_preferences(
                node_integration, context_isolation, sandbox, web_security,
              ).to_json(),
            ),
          ])
        _ => invalid_payload()
      }
    _ => "{\"ok\":false,\"code\":\"ELECTRON_MBT_UNSUPPORTED_API\"}"
  }
}

///|
// JSON permits insignificant whitespace around a value, so the envelope is
// classified on the first non-whitespace character; bare string ops keep their
// exact-match form and are never whitespace-normalized.
fn is_envelope(raw : String) -> Bool {
  raw.trim_start(chars=" \t\n\r").has_prefix("{")
}

///|
pub fn dispatch(runtime : @core.Runtime, operation : String) -> String {
  if is_envelope(operation) {
    return dispatch_json(runtime, operation)
  }
  match operation {
    "ready" => code_result(runtime.ready())
    "begin-quit" => code_result(runtime.begin_quit())
    "cancel-quit" => code_result(runtime.cancel_quit())
    "stop" => {
      runtime.stop()
      "{\"ok\":true}"
    }
    "state" => {
      let result : Json = {
        "ok": true,
        "state": runtime.app_state().name().to_json(),
      }
      result.stringify()
    }
    _ => "{\"ok\":false,\"code\":\"ELECTRON_MBT_UNSUPPORTED_API\"}"
  }
}

///|
// Leaf adapters gather each runtime's raw observation; the compiled core owns
// the comparison so no verdict logic is re-implemented in JavaScript.
pub fn compare_observations(electron : String, mbt : String) -> String {
  if electron.length() > 16384 || mbt.length() > 16384 {
    return "{\"ok\":false,\"code\":\"InvalidPayload\"}"
  }
  let left = @json.parse(electron) catch { _ => return invalid_payload() }
  let right = @json.parse(mbt) catch { _ => return invalid_payload() }
  @core.compare_observations(left, right).stringify()
}

///|
pub fn diagnose(raw : String) -> String {
  // This is a bounded leaf-to-core metadata contract, not a renderer IPC codec.
  if raw.length() > 16384 {
    return "{\"ok\":false,\"code\":\"ELECTRON_MBT_LIMIT\"}"
  }
  let value = @json.parse(raw) catch {
    _ => return "{\"ok\":false,\"code\":\"ELECTRON_MBT_INVALID_METADATA\"}"
  }
  let problems : Array[Json] = []
  if text(value, "entryType") != "commonjs" {
    problems.push("ELECTRON_MBT_UNSUPPORTED_ENTRY".to_json())
  }
  if !(field(value, "nativeAddons") is False) {
    problems.push("ELECTRON_MBT_NATIVE_ADDON_UNVERIFIED".to_json())
  }
  if text(value, "platform") != "darwin" {
    problems.push("ELECTRON_MBT_UNSUPPORTED_PLATFORM".to_json())
  }
  problems.push("ELECTRON_MBT_M0_INCOMPLETE".to_json())
  let result : Json = {
    "ok": false,
    "compatible": false,
    "status": "not_verified",
    "diagnostics": problems.to_json(),
  }
  result.stringify()
}


///|
pub fn window_reserve(runtime : @core.Runtime) -> String {
  let response : Json = match runtime.reserve_window() {
    Ok(id) => { "ok": true, "id": id.to_json() }
    Err(error) => { "ok": false, "code": error.code().to_json() }
  }
  response.stringify()
}

///|
pub fn window_confirm(runtime : @core.Runtime, id : Int) -> String {
  code_result(runtime.confirm_window(id))
}

///|
pub fn window_begin_close(runtime : @core.Runtime, id : Int) -> String {
  code_result(runtime.begin_close(id))
}

///|
pub fn window_cancel_close(runtime : @core.Runtime, id : Int) -> String {
  code_result(runtime.cancel_close(id))
}

///|
pub fn window_navigate(runtime : @core.Runtime, id : Int) -> String {
  let response : Json = match runtime.navigate(id) {
    Ok(generation) => { "ok": true, "generation": generation.to_json() }
    Err(error) => { "ok": false, "code": error.code().to_json() }
  }
  response.stringify()
}

///|
pub fn window_destroy(runtime : @core.Runtime, id : Int) -> Bool {
  runtime.destroy_window(id)
}


///|
pub fn window_invalidate(runtime : @core.Runtime, id : Int, generation : Int) -> String {
  code_result(runtime.invalidate_document(id, generation))
}
