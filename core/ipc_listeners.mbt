///|
struct MainListener {
  id : Int32
  channel : String
}

///|
fn Runtime::check_listener_channel(
  self : Runtime,
  channel : String,
) -> Result[Unit, RuntimeError] {
  if self.app == Stopped {
    return Err(InvalidState)
  }
  if channel == "" {
    return Err(InvalidPayload)
  }
  if channel.length() > 128 {
    return Err(LimitExceeded)
  }
  // EventEmitter meta-events and its special error event need a separate contract.
  if channel == "newListener" || channel == "removeListener" || channel == "error" {
    return Err(Denied)
  }
  Ok(())
}

///|
pub fn Runtime::ipc_add_listener(
  self : Runtime,
  channel : String,
) -> Result[Int32, RuntimeError] {
  match self.check_listener_channel(channel) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  if self.ipc_listeners.length() >= 256 {
    return Err(LimitExceeded)
  }
  if self.next_listener == 2147483647 {
    return Err(IdExhausted)
  }
  let id = self.next_listener
  self.next_listener += 1
  self.ipc_listeners.push({ id, channel, })
  Ok(id)
}

///|
pub fn Runtime::ipc_listener_snapshot(
  self : Runtime,
  channel : String,
) -> Result[Array[Int32], RuntimeError] {
  match self.check_listener_channel(channel) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  let ids : Array[Int32] = []
  for listener in self.ipc_listeners {
    if listener.channel == channel {
      ids.push(listener.id)
    }
  }
  Ok(ids)
}

///|
pub fn Runtime::ipc_remove_listener(
  self : Runtime,
  id : Int32,
) -> Result[Bool, RuntimeError] {
  if self.app == Stopped {
    return Err(InvalidState)
  }
  if id <= 0 {
    return Err(InvalidPayload)
  }
  for index = 0; index < self.ipc_listeners.length(); index += 1 {
    if self.ipc_listeners[index].id == id {
      self.ipc_listeners.remove(index) |> ignore
      return Ok(true)
    }
  }
  Ok(false)
}

///|
pub fn Runtime::ipc_clear_listeners(
  self : Runtime,
  channel : String?,
) -> Result[Array[Int32], RuntimeError] {
  if self.app == Stopped {
    return Err(InvalidState)
  }
  match channel {
    Some(channel) =>
      match self.check_listener_channel(channel) {
        Err(error) => return Err(error)
        Ok(_) => ()
      }
    None => ()
  }
  let ids : Array[Int32] = []
  let mut index = 0
  while index < self.ipc_listeners.length() {
    let listener = self.ipc_listeners[index]
    if channel is None || channel == Some(listener.channel) {
      ids.push(listener.id)
      self.ipc_listeners.remove(index) |> ignore
    } else {
      index += 1
    }
  }
  Ok(ids)
}
