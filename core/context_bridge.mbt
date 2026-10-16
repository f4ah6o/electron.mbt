///|
pub(all) enum BridgeHandleKind {
  FunctionProxy
  CallbackProxy
  PromiseProxy
} derive(Eq)

///|
pub extend BridgeHandleKind with Eq::{equal, not_equal}

///|
struct BridgeHandle {
  window : Int
  generation : Int
  channel : String
  kind : BridgeHandleKind
}

///|
pub fn Runtime::register_bridge_handle(
  self : Runtime,
  window : Int,
  generation : Int,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  kind : BridgeHandleKind,
) -> Result[Int, RuntimeError] {
  match self.authorize(window, generation, host_origin, main_frame, channel) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  if self.bridge_handles.length() >= 4096 { return Err(LimitExceeded) }
  let mut document_count = 0
  for _, handle in self.bridge_handles {
    if handle.window == window { document_count += 1 }
  }
  if document_count >= 256 { return Err(LimitExceeded) }
  if self.next_bridge_handle == 2147483647 { return Err(IdExhausted) }
  let id = self.next_bridge_handle
  self.next_bridge_handle += 1
  self.bridge_handles[id] = { window, generation, channel, kind }
  Ok(id)
}

///|
pub fn Runtime::validate_bridge_handle(
  self : Runtime,
  window : Int,
  generation : Int,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  handle_id : Int,
  kind : BridgeHandleKind,
) -> Result[Unit, RuntimeError] {
  // IDs are correlation only: possession must never replace native authority.
  match self.authorize(window, generation, host_origin, main_frame, channel) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match self.bridge_handles.get(handle_id) {
    None => Err(UnknownBridgeHandle)
    Some(handle) => {
      if handle.window != window || handle.generation != generation ||
        handle.channel != channel || handle.kind != kind {
        return Err(Denied)
      }
      Ok(())
    }
  }
}

///|
pub fn Runtime::release_bridge_handle(
  self : Runtime,
  window : Int,
  generation : Int,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  handle_id : Int,
  kind : BridgeHandleKind,
) -> Result[Bool, RuntimeError] {
  match self.validate_bridge_handle(
    window, generation, host_origin, main_frame, channel, handle_id, kind,
  ) {
    Ok(_) => {
      self.bridge_handles.remove(handle_id)
      Ok(true)
    }
    Err(UnknownBridgeHandle) => Ok(false)
    Err(error) => Err(error)
  }
}

///|
pub fn Runtime::settle_bridge_promise(
  self : Runtime,
  window : Int,
  generation : Int,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  handle_id : Int,
) -> Result[Unit, RuntimeError] {
  match self.validate_bridge_handle(
    window, generation, host_origin, main_frame, channel, handle_id, PromiseProxy,
  ) {
    Err(error) => Err(error)
    Ok(_) => {
      // Retaining the record until JS runs would allow a reentrant settlement.
      self.bridge_handles.remove(handle_id)
      Ok(())
    }
  }
}

///|
fn Runtime::revoke_bridge_handles(self : Runtime, window : Int) -> Unit {
  let ids : Array[Int] = []
  for id, handle in self.bridge_handles {
    if handle.window == window { ids.push(id) }
  }
  for id in ids { self.bridge_handles.remove(id) }
}

///|
pub fn Runtime::bridge_handle_count(self : Runtime) -> Int {
  self.bridge_handles.length()
}
