///|
struct PendingControl {
  window : Int64
  generation : Int64
  operation : String
  bytes : Int
}

///|
pub struct Session {
  expected : String
  pending : Map[Int64, PendingControl]
  mut last_issued : Int64
  mut queued_bytes : Int
  mut closed : Bool
}

///|
pub fn Session::new(expected : String) -> Session {
  { expected, pending: {}, last_issued: 0L, queued_bytes: 0, closed: !session_valid(expected) }
}

///|
pub fn Session::status(self : Session) -> Result[Unit, String] {
  if self.closed { Err("Session closed or invalid") } else { Ok(()) }
}

///|
fn Session::read(self : Session, raw : String) -> Envelope raise BadProtocol {
  if self.closed { raise BadProtocol("Session closed") }
  let envelope = parse_wire(raw)
  // A correlated identifier is not native peer authentication. Only a future
  // private transport adapter can supply authenticated OS peer/document state.
  if envelope.session != self.expected { raise BadProtocol("Session mismatch") }
  envelope
}

///|
pub fn Session::register(self : Session, raw : String) -> Result[Unit, String] {
  try {
    let envelope = self.read(raw)
    if envelope.terminal { raise BadProtocol("Cannot register a completion") }
    if envelope.request <= self.last_issued { raise BadProtocol("Request ID must increase") }
    if self.pending.length() >= MaxPending || self.queued_bytes > MaxQueuedBytes - envelope.bytes {
      raise BadProtocol("Pending request budget exceeded")
    }
    self.pending[envelope.request] = {
      window: envelope.window, generation: envelope.generation,
      operation: envelope.operation, bytes: envelope.bytes,
    }
    self.queued_bytes += envelope.bytes
    self.last_issued = envelope.request
    Ok(())
  } catch { BadProtocol(message) => Err(message) }
}

///|
pub fn Session::accept(self : Session, raw : String) -> Result[Unit, String] {
  try {
    let envelope = self.read(raw)
    if !envelope.terminal { raise BadProtocol("Expected terminal response") }
    let expected = match self.pending.get(envelope.request) {
      Some(value) => value
      None => raise BadProtocol("Unknown, duplicate or late completion")
    }
    if envelope.window != expected.window || envelope.generation != expected.generation || envelope.operation != expected.operation {
      raise BadProtocol("Stale or mismatched completion")
    }
    self.pending.remove(envelope.request)
    self.queued_bytes -= expected.bytes
    Ok(())
  } catch { BadProtocol(message) => Err(message) }
}

///|
pub fn Session::cancel(self : Session, request : Double) -> Result[Bool, String] {
  try {
    if self.closed { raise BadProtocol("Session closed") }
    let id = identifier(request.to_json())
    match self.pending.get(id) {
      Some(value) => {
        self.pending.remove(id)
        self.queued_bytes -= value.bytes
        Ok(true)
      }
      None => Ok(false)
    }
  } catch { BadProtocol(message) => Err(message) }
}

///|
pub fn Session::pending_count(self : Session) -> Int { self.pending.length() }

///|
pub fn Session::close(self : Session) -> Array[Int64] {
  let cancelled = []
  for id, _ in self.pending { cancelled.push(id) }
  self.closed = true
  self.pending.clear()
  self.queued_bytes = 0
  cancelled
}
