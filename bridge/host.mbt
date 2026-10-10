///|
fn host_result(result : Result[Unit, String]) -> String {
  let response : Json = match result {
    Ok(_) => { "ok": true }
    Err(message) => { "ok": false, "message": message.to_json() }
  }
  response.stringify()
}

///|
pub fn host_limits() -> String { @transport.limits().stringify() }

///|
pub fn host_validate(raw : String) -> String { host_result(@transport.validate(raw)) }

///|
pub fn host_new(expected : String) -> @transport.Session { @transport.Session::new(expected) }

///|
pub fn host_status(session : @transport.Session) -> String { host_result(session.status()) }

///|
pub fn host_register(session : @transport.Session, raw : String) -> String {
  host_result(session.register(raw))
}

///|
pub fn host_accept(session : @transport.Session, raw : String) -> String {
  host_result(session.accept(raw))
}

///|
pub fn host_cancel(session : @transport.Session, id : Double) -> String {
  let response : Json = match session.cancel(id) {
    Ok(value) => { "ok": true, "value": value.to_json() }
    Err(message) => { "ok": false, "message": message.to_json() }
  }
  response.stringify()
}

///|
pub fn host_pending(session : @transport.Session) -> Int { session.pending_count() }

///|
pub fn host_close(session : @transport.Session) -> String { session.close().to_json().stringify() }
