///|
fn bridge_id(value : Json) -> Int32? {
  guard value is String(token) else { return None }
  if token.length() == 0 || token.length() > 10 || token[0].to_int() == 48 {
    return None
  }
  let mut id = 0
  for i = 0; i < token.length(); i = i + 1 {
    let digit = token[i].to_int() - 48
    if digit < 0 || digit > 9 || id > (2147483647 - digit) / 10 {
      return None
    }
    id = id * 10 + digit
  }
  Some(id)
}

///|
fn bridge_shape(value : Json, keys : Array[String]) -> Bool {
  guard value is Object(fields) else { return false }
  if fields.length() != keys.length() { return false }
  for key in keys { if !fields.contains(key) { return false } }
  true
}

///|
fn bridge_flat(raw : String) -> Bool {
  let mut depth = 0
  let mut quoted = false
  let mut escaped = false
  for i = 0; i < raw.length(); i = i + 1 {
    let c = raw[i].to_int()
    if quoted {
      if escaped { escaped = false }
      else if c == 92 { escaped = true }
      else if c == 34 { quoted = false }
    } else if c == 34 { quoted = true }
    else if c == 91 || c == 93 { return false }
    else if c == 123 {
      depth += 1
      if depth > 1 { return false }
    } else if c == 125 { depth -= 1 }
  }
  depth == 0 && !quoted
}

///|
pub fn context_bridge_dispatch(runtime : @core.Runtime, raw : String) -> String {
  // Canonical decimal strings avoid JS Int32 coercion and JSON Double rounding.
  let invalid = "{\"ok\":false,\"code\":\"InvalidPayload\"}"
  if raw.length() > 2048 {
    return "{\"ok\":false,\"code\":\"LimitExceeded\"}"
  }
  if !bridge_flat(raw) { return invalid }
  let value = @json.parse(raw) catch { _ => return invalid }
  let operation = text(value, "op")
  let keys = match operation {
    "activate" => ["op", "window", "generation", "origin"]
    "grant" => ["op", "window", "generation", "channel"]
    "register" => ["op", "window", "generation", "origin", "mainFrame", "channel", "kind"]
    "validate" | "release" | "settle" =>
      ["op", "window", "generation", "origin", "mainFrame", "channel", "kind", "id"]
    _ => return invalid
  }
  if !bridge_shape(value, keys) { return invalid }
  let window = match bridge_id(field(value, "window")) {
    Some(id) => id
    None => return invalid
  }
  let generation = match bridge_id(field(value, "generation")) {
    Some(id) => id
    None => return invalid
  }
  let origin = text(value, "origin")
  let channel = text(value, "channel")
  if operation != "grant" && (origin == "" || origin.length() > 1024) {
    return invalid
  }
  if operation == "activate" {
    return code_result(runtime.activate_document(window, generation, origin))
  }
  if channel == "" || channel.length() > 128 { return invalid }
  if operation == "grant" {
    return code_result(runtime.grant(window, generation, channel))
  }
  let main_frame = match field(value, "mainFrame") {
    True => true
    False => false
    _ => return invalid
  }
  let kind : @core.BridgeHandleKind = match text(value, "kind") {
    "function" => FunctionProxy
    "callback" => CallbackProxy
    "promise" => PromiseProxy
    _ => return invalid
  }
  if operation == "register" {
    let response : Json = match runtime.register_bridge_handle(
      window, generation, origin, main_frame, channel, kind,
    ) {
      Ok(id) => { "ok": true, "id": id.to_json() }
      Err(error) => { "ok": false, "code": error.code().to_json() }
    }
    return response.stringify()
  }
  let id = match bridge_id(field(value, "id")) {
    Some(id) => id
    None => return invalid
  }
  match operation {
    "validate" => code_result(runtime.validate_bridge_handle(
      window, generation, origin, main_frame, channel, id, kind,
    ))
    "release" => {
      let response : Json = match runtime.release_bridge_handle(
        window, generation, origin, main_frame, channel, id, kind,
      ) {
        Ok(released) => { "ok": true, "released": released.to_json() }
        Err(error) => { "ok": false, "code": error.code().to_json() }
      }
      response.stringify()
    }
    "settle" => {
      if kind != PromiseProxy { return invalid }
      code_result(runtime.settle_bridge_promise(
        window, generation, origin, main_frame, channel, id,
      ))
    }
    _ => invalid
  }
}

///|
pub fn context_bridge_retained(runtime : @core.Runtime, id : Int32) -> Bool {
  // Internal cleanup only; this query cannot authorize invocation or settlement.
  runtime.contains_bridge_handle(id)
}

///|
pub fn context_bridge_count(runtime : @core.Runtime) -> Int {
  runtime.bridge_handle_count()
}
