///|
pub(all) enum InvokeError {
  CoreError(RuntimeError)
  DuplicateHandler
  UnknownHandler
}

///|
pub fn InvokeError::code(self : InvokeError) -> String {
  match self {
    CoreError(error) => error.code()
    DuplicateHandler => "DuplicateHandler"
    UnknownHandler => "UnknownHandler"
  }
}

///|
priv struct InvokeHandler {
  id : Int32
  once : Bool
}

///|
priv struct Invocation {
  window : Int32
  generation : Int32
  origin : String
  channel : String
}

///|
pub struct InvokeRegistry {
  runtime : Runtime
  handlers : Map[String, InvokeHandler]
  invocations : Map[Int32, Invocation]
  mut next_handler : Int32
  mut disposed : Bool
}

///|
pub fn InvokeRegistry::new(runtime : Runtime) -> InvokeRegistry {
  { runtime, handlers: {}, invocations: {}, next_handler: 1, disposed: false }
}

///|
fn InvokeRegistry::active(self : InvokeRegistry) -> Result[Unit, InvokeError] {
  if self.disposed || self.runtime.app_state() == Stopped {
    self.dispose()
    Err(CoreError(InvalidState))
  } else {
    Ok(())
  }
}

///|
fn invoke_channel(channel : String) -> Result[Unit, InvokeError] {
  if channel == "" {
    Err(CoreError(InvalidPayload))
  } else if channel.length() > 128 {
    Err(CoreError(LimitExceeded))
  } else {
    Ok(())
  }
}

///|
pub fn InvokeRegistry::register(
  self : InvokeRegistry,
  channel : String,
  once : Bool,
  callable : Bool,
) -> Result[Int32, InvokeError] {
  match self.active() { Err(error) => return Err(error); Ok(_) => () }
  match invoke_channel(channel) { Err(error) => return Err(error); Ok(_) => () }
  if self.handlers.contains(channel) {
    return Err(DuplicateHandler)
  }
  if !callable {
    return Err(CoreError(InvalidPayload))
  }
  if self.handlers.length() >= 128 {
    return Err(CoreError(LimitExceeded))
  }
  if self.next_handler == 2147483647 {
    return Err(CoreError(IdExhausted))
  }
  let id = self.next_handler
  self.next_handler += 1
  self.handlers[channel] = { id, once }
  Ok(id)
}

///|
pub fn InvokeRegistry::remove(
  self : InvokeRegistry,
  channel : String,
) -> Result[Int32, InvokeError] {
  match self.active() { Err(error) => return Err(error); Ok(_) => () }
  match invoke_channel(channel) { Err(error) => return Err(error); Ok(_) => () }
  match self.handlers.get(channel) {
    Some(handler) => { self.handlers.remove(channel); Ok(handler.id) }
    None => Ok(0)
  }
}

///|
pub fn InvokeRegistry::begin(
  self : InvokeRegistry,
  window : Int32,
  generation : Int32,
  origin : String,
  main_frame : Bool,
  channel : String,
  bytes : Int32,
) -> Result[(Int32, Int32, Bool), InvokeError] {
  match self.active() { Err(error) => return Err(error); Ok(_) => () }
  // Looking up a handler before authorization would disclose channel presence.
  match self.runtime.authorize(window, generation, origin, main_frame, channel) {
    Err(error) => return Err(CoreError(error))
    Ok(_) => ()
  }
  let handler = match self.handlers.get(channel) {
    Some(handler) => handler
    None => return Err(UnknownHandler)
  }
  // The host may drain cancellation notifications before this owner acknowledges
  // its invocation tickets; pending_count alone would then permit unbounded tickets.
  if self.invocations.length() >= 256 {
    return Err(CoreError(LimitExceeded))
  }
  let request = match
    self.runtime.begin_request(window, generation, origin, main_frame, channel, bytes) {
    Ok(request) => request
    Err(error) => return Err(CoreError(error))
  }
  self.invocations[request] = { window, generation, origin, channel }
  if handler.once {
    self.handlers.remove(channel)
  }
  Ok((request, handler.id, handler.once))
}

///|
pub fn InvokeRegistry::check(
  self : InvokeRegistry,
  request : Int32,
) -> Result[Unit, InvokeError] {
  let invocation = match self.invocations.get(request) {
    Some(invocation) => invocation
    None =>
      return if self.runtime.terminal.contains(request) {
        Err(CoreError(AlreadyCompleted))
      } else {
        Err(CoreError(UnknownRequest))
      }
  }
  match self.runtime.pending.get(request) {
    None => return Err(CoreError(AlreadyCompleted))
    Some(pending) =>
      if pending.window != invocation.window || pending.generation != invocation.generation {
        return Err(CoreError(StaleDocument))
      }
  }
  match self.runtime.authorize(
    invocation.window, invocation.generation, invocation.origin, true, invocation.channel,
  ) {
    Ok(_) => Ok(())
    Err(error) => Err(CoreError(error))
  }
}

///|
fn InvokeRegistry::retire(self : InvokeRegistry, request : Int32) -> Bool {
  let invocation = match self.invocations.get(request) {
    Some(invocation) => invocation
    None => return false
  }
  self.invocations.remove(request)
  self.runtime.complete_request(request, invocation.window, invocation.generation) |> ignore
  // Taking the entire cancellation queue would steal notifications belonging to
  // other host services. Acknowledge only the ticket owned by this registry.
  for index = 0; index < self.runtime.cancelled.length(); index = index + 1 {
    if self.runtime.cancelled[index] == request {
      self.runtime.cancelled.remove(index) |> ignore
      break
    }
  }
  true
}

///|
pub fn InvokeRegistry::finish(
  self : InvokeRegistry,
  request : Int32,
) -> Result[Unit, InvokeError] {
  let result = self.check(request)
  self.retire(request) |> ignore
  result
}

///|
pub fn InvokeRegistry::cancel(self : InvokeRegistry, request : Int32) -> Bool {
  self.retire(request)
}

///|
pub fn InvokeRegistry::dispose(self : InvokeRegistry) -> Unit {
  let ids : Array[Int32] = []
  for id, _ in self.invocations { ids.push(id) }
  for id in ids { self.retire(id) |> ignore }
  self.handlers.clear()
  self.disposed = true
}

///|
pub fn InvokeRegistry::handler_count(self : InvokeRegistry) -> Int32 {
  self.handlers.length()
}

///|
pub fn InvokeRegistry::invocation_count(self : InvokeRegistry) -> Int32 {
  self.invocations.length()
}
