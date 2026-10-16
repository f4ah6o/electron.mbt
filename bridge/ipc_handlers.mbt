///|
pub fn new_invokes(runtime : @core.Runtime) -> @core.InvokeRegistry {
  @core.InvokeRegistry::new(runtime)
}

///|
fn invoke_error(error : @core.InvokeError) -> String {
  let value : Json = { "ok": false, "code": error.code().to_json() }
  value.stringify()
}

///|
fn invoke_unit(result : Result[Unit, @core.InvokeError]) -> String {
  match result {
    Ok(_) => respond([])
    Err(error) => invoke_error(error)
  }
}

///|
pub fn dispatch_invokes(registry : @core.InvokeRegistry, raw : String) -> String {
  if raw.length() > 16384 { return invalid_payload() }
  let value = @json.parse(raw) catch { _ => return invalid_payload() }
  match text(value, "op") {
    "register" =>
      match (arg_text(value, "channel"), arg_bool(value, "once"), arg_bool(value, "callable")) {
        (Ok(channel), Ok(once), Ok(callable)) =>
          match registry.register(channel, once, callable) {
            Ok(id) => respond([("handler", id.to_json())])
            Err(error) => invoke_error(error)
          }
        _ => invalid_payload()
      }
    "remove" =>
      match arg_text(value, "channel") {
        Ok(channel) =>
          match registry.remove(channel) {
            Ok(id) => respond([("handler", id.to_json())])
            Err(error) => invoke_error(error)
          }
        _ => invalid_payload()
      }
    "begin" =>
      match (
        arg_int(value, "window"), arg_int(value, "generation"),
        arg_text(value, "host_origin"), arg_bool(value, "main_frame"),
        arg_text(value, "channel"), arg_int(value, "payload_bytes"),
      ) {
        (Ok(window), Ok(generation), Ok(origin), Ok(main_frame), Ok(channel), Ok(bytes)) =>
          match registry.begin(window, generation, origin, main_frame, channel, bytes) {
            Ok((request, handler, once)) => respond([
              ("request", request.to_json()), ("handler", handler.to_json()), ("once", once.to_json()),
            ])
            Err(error) => invoke_error(error)
          }
        _ => invalid_payload()
      }
    "check" =>
      match arg_int(value, "request") {
        Ok(request) => invoke_unit(registry.check(request))
        _ => invalid_payload()
      }
    "finish" =>
      match arg_int(value, "request") {
        Ok(request) => invoke_unit(registry.finish(request))
        _ => invalid_payload()
      }
    "cancel" =>
      match arg_int(value, "request") {
        Ok(request) => respond([("cancelled", registry.cancel(request).to_json())])
        _ => invalid_payload()
      }
    "dispose" => { registry.dispose(); respond([]) }
    "stats" => respond([
      ("handlers", registry.handler_count().to_json()),
      ("invocations", registry.invocation_count().to_json()),
    ])
    _ => "{\"ok\":false,\"code\":\"ELECTRON_MBT_UNSUPPORTED_API\"}"
  }
}
