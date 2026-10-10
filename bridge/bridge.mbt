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
pub fn dispatch(runtime : @core.Runtime, operation : String) -> String {
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
