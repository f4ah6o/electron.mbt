///|
pub(all) enum AppState {
  Booting
  Ready
  Quitting
  Stopped
} derive(Eq, Show)

///|
pub(all) enum WindowState {
  Creating
  Live
  Closing
} derive(Eq, Show)

///|
pub(all) enum RuntimeError {
  InvalidState
  UnknownWindow
  StaleDocument
  Denied
  LimitExceeded
  InvalidPayload
  UnknownRequest
  AlreadyCompleted
  IdExhausted
} derive(Eq, Show)

///|
struct Window {
  mut state : WindowState
  mut generation : Int
  mut origin : String
  mut active : Bool
  grants : Map[String, Bool]
}

///|
struct Pending {
  window : Int
  generation : Int
  bytes : Int
}

///|
pub struct Runtime {
  mut app : AppState
  windows : Map[Int, Window]
  pending : Map[Int, Pending]
  terminal : Array[Int]
  cancelled : Array[Int]
  mut next_window : Int
  mut next_request : Int
  mut queue_bytes : Int
}

///|
pub fn Runtime::new() -> Runtime {
  {
    app: Booting,
    windows: {},
    pending: {},
    terminal: [],
    cancelled: [],
    next_window: 1,
    next_request: 1,
    queue_bytes: 0,
  }
}

///|
pub fn Runtime::app_state(self : Runtime) -> AppState {
  self.app
}

///|
pub fn Runtime::ready(self : Runtime) -> Result[Unit, RuntimeError] {
  if self.app != Booting { return Err(InvalidState) }
  self.app = Ready
  Ok(())
}

///|
pub fn Runtime::begin_quit(self : Runtime) -> Result[Unit, RuntimeError] {
  if self.app != Ready { return Err(InvalidState) }
  self.app = Quitting
  Ok(())
}

///|
pub fn Runtime::cancel_quit(self : Runtime) -> Result[Unit, RuntimeError] {
  if self.app != Quitting { return Err(InvalidState) }
  self.app = Ready
  Ok(())
}

///|
pub fn Runtime::stop(self : Runtime) -> Unit {
  self.app = Stopped
  for id, _ in self.pending {
    self.cancelled.push(id)
    self.remember_terminal(id)
  }
  self.windows.clear()
  self.pending.clear()
  self.queue_bytes = 0
}

///|
pub fn Runtime::reserve_window(self : Runtime) -> Result[Int, RuntimeError] {
  if self.app != Ready { return Err(InvalidState) }
  if self.windows.length() >= 64 { return Err(LimitExceeded) }
  if self.next_window == 2147483647 { return Err(IdExhausted) }
  let id = self.next_window
  self.next_window += 1
  self.windows[id] = {
    state: Creating,
    generation: 0,
    origin: "",
    active: false,
    grants: {},
  }
  Ok(id)
}

///|
pub fn Runtime::confirm_window(
  self : Runtime,
  id : Int,
) -> Result[Unit, RuntimeError] {
  match self.windows.get(id) {
    Some(window) => {
      if window.state != Creating { return Err(InvalidState) }
      window.state = Live
      Ok(())
    }
    None => Err(UnknownWindow)
  }
}

///|
pub fn Runtime::window_state(
  self : Runtime,
  id : Int,
) -> Result[WindowState, RuntimeError] {
  match self.windows.get(id) {
    Some(window) => Ok(window.state)
    None => Err(UnknownWindow)
  }
}

///|
pub fn Runtime::begin_close(
  self : Runtime,
  id : Int,
) -> Result[Unit, RuntimeError] {
  match self.windows.get(id) {
    Some(window) => {
      if window.state != Live { return Err(InvalidState) }
      window.state = Closing
      Ok(())
    }
    None => Err(UnknownWindow)
  }
}

///|
pub fn Runtime::cancel_close(
  self : Runtime,
  id : Int,
) -> Result[Unit, RuntimeError] {
  match self.windows.get(id) {
    Some(window) => {
      if window.state != Closing { return Err(InvalidState) }
      window.state = Live
      Ok(())
    }
    None => Err(UnknownWindow)
  }
}

///|
fn Runtime::remember_terminal(self : Runtime, id : Int) -> Unit {
  // An unbounded completed-request ledger would defeat the pending-work limit.
  if self.terminal.length() == 1024 {
    self.terminal.remove(0) |> ignore
  }
  self.terminal.push(id)
}

///|
fn Runtime::cancel_window_requests(self : Runtime, window : Int) -> Unit {
  let ids : Array[Int] = []
  for id, pending in self.pending {
    if pending.window == window { ids.push(id) }
  }
  for id in ids {
    match self.pending.get(id) {
      Some(pending) => {
        self.queue_bytes -= pending.bytes
        self.pending.remove(id)
        self.remember_terminal(id)
        self.cancelled.push(id)
      }
      None => ()
    }
  }
}

///|
pub fn Runtime::destroy_window(self : Runtime, id : Int) -> Bool {
  if not(self.windows.contains(id)) { return false }
  self.cancel_window_requests(id)
  self.windows.remove(id)
  true
}

///|
pub fn Runtime::navigate(
  self : Runtime,
  id : Int,
) -> Result[Int, RuntimeError] {
  match self.windows.get(id) {
    Some(window) => {
      if window.state != Live { return Err(InvalidState) }
      if window.generation == 2147483647 { return Err(IdExhausted) }
      window.generation += 1
      window.active = false
      window.origin = ""
      window.grants.clear()
      self.cancel_window_requests(id)
      Ok(window.generation)
    }
    None => Err(UnknownWindow)
  }
}

///|
pub fn Runtime::activate_document(
  self : Runtime,
  id : Int,
  generation : Int,
  host_origin : String,
) -> Result[Unit, RuntimeError] {
  match self.windows.get(id) {
    Some(window) => {
      if window.state != Live { return Err(InvalidState) }
      if generation <= 0 || window.generation != generation {
        return Err(StaleDocument)
      }
      if window.active { return Err(InvalidState) }
      if host_origin == "" || host_origin == "null" { return Err(Denied) }
      window.origin = host_origin
      window.active = true
      Ok(())
    }
    None => Err(UnknownWindow)
  }
}

///|
pub fn Runtime::grant(
  self : Runtime,
  id : Int,
  generation : Int,
  channel : String,
) -> Result[Unit, RuntimeError] {
  match self.windows.get(id) {
    Some(window) => {
      if window.state != Live || not(window.active) {
        return Err(InvalidState)
      }
      if window.generation != generation { return Err(StaleDocument) }
      if channel == "" || channel.length() > 128 { return Err(Denied) }
      if window.grants.length() >= 128 && not(window.grants.contains(channel)) {
        return Err(LimitExceeded)
      }
      window.grants[channel] = true
      Ok(())
    }
    None => Err(UnknownWindow)
  }
}

///|
pub fn Runtime::authorize(
  self : Runtime,
  id : Int,
  generation : Int,
  host_origin : String,
  main_frame : Bool,
  channel : String,
) -> Result[Unit, RuntimeError] {
  if self.app != Ready { return Err(InvalidState) }
  match self.windows.get(id) {
    Some(window) => {
      if window.state != Live || not(window.active) {
        return Err(InvalidState)
      }
      if window.generation != generation { return Err(StaleDocument) }
      if not(main_frame) || window.origin != host_origin {
        return Err(Denied)
      }
      if not(window.grants.contains(channel)) { return Err(Denied) }
      Ok(())
    }
    None => Err(UnknownWindow)
  }
}

///|
pub fn Runtime::begin_request(
  self : Runtime,
  id : Int,
  generation : Int,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  payload_bytes : Int,
) -> Result[Int, RuntimeError] {
  match self.authorize(id, generation, host_origin, main_frame, channel) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  if payload_bytes < 0 || payload_bytes > 1048576 {
    return Err(LimitExceeded)
  }
  if self.pending.length() + self.cancelled.length() >= 256 || self.queue_bytes > 4194304 - payload_bytes {
    return Err(LimitExceeded)
  }
  if self.next_request == 2147483647 { return Err(IdExhausted) }
  let request = self.next_request
  self.next_request += 1
  self.pending[request] = { window: id, generation, bytes: payload_bytes }
  self.queue_bytes += payload_bytes
  Ok(request)
}

///|
pub fn Runtime::complete_request(
  self : Runtime,
  request : Int,
  id : Int,
  generation : Int,
) -> Result[Unit, RuntimeError] {
  match self.pending.get(request) {
    Some(pending) => {
      if pending.window != id || pending.generation != generation {
        return Err(StaleDocument)
      }
      self.pending.remove(request)
      self.queue_bytes -= pending.bytes
      self.remember_terminal(request)
      Ok(())
    }
    None => {
      if self.terminal.contains(request) {
        Err(AlreadyCompleted)
      } else {
        Err(UnknownRequest)
      }
    }
  }
}

///|
pub fn Runtime::pending_count(self : Runtime) -> Int {
  self.pending.length()
}

///|
pub fn Runtime::queued_bytes(self : Runtime) -> Int {
  self.queue_bytes
}

///|
pub fn validate_preferences(
  node_integration : Bool,
  context_isolation : Bool,
  sandbox : Bool,
  web_security : Bool,
) -> Bool {
  not(node_integration) && context_isolation && sandbox && web_security
}

///|
pub fn validate_json(value : Json, depth : Int = 0) -> Bool {
  if depth > 64 { return false }
  match value {
    Null | True | False | String(_) => true
    Number(number) => number.is_finite()
    Array(values) => {
      for value in values {
        if not(validate_json(value, depth + 1)) { return false }
      }
      true
    }
    Object(values) => {
      for _, value in values {
        if not(validate_json(value, depth + 1)) { return false }
      }
      true
    }
  }
}

///|
pub fn Runtime::take_cancellations(self : Runtime) -> Array[Int] {
  let result = self.cancelled.copy()
  self.cancelled.clear()
  result
}
