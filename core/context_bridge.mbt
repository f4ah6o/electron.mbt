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
  window : Int32
  generation : Int32
  channel : String
  kind : BridgeHandleKind
}

///|
pub fn Runtime::register_bridge_handle(
  self : Runtime,
  window : Int32,
  generation : Int32,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  kind : BridgeHandleKind,
) -> Result[Int32, RuntimeError] {
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
  window : Int32,
  generation : Int32,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  handle_id : Int32,
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
  window : Int32,
  generation : Int32,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  handle_id : Int32,
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
  window : Int32,
  generation : Int32,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  handle_id : Int32,
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
fn Runtime::revoke_bridge_handles(self : Runtime, window : Int32) -> Unit {
  let ids : Array[Int32] = []
  for id, handle in self.bridge_handles {
    if handle.window == window { ids.push(id) }
  }
  for id in ids { self.bridge_handles.remove(id) }
  self.revoke_bridge_exposures(window)
}

///|
pub fn Runtime::bridge_handle_count(self : Runtime) -> Int {
  self.bridge_handles.length()
}

///|
// Why not store the JS descriptor or function bodies here: MoonBit owns only
// bounded authority metadata; the actual descriptor tree and closures remain
// in their source realm. The host supplies the descriptor hash as trusted
// metadata, exactly as it supplies the document origin and frame flag.
struct BridgeExposure {
  window : Int32
  generation : Int32
  channel : String
  api_key : String
  descriptor_bytes : Int32
  function_count : Int32
  descriptor_sha256 : String
}

///|
fn bridge_api_key_reserved(key : String) -> Bool {
  key == "window" || key == "document" || key == "globalThis" ||
  key == "process" || key == "require" || key == "module" ||
  key == "exports" || key == "electron" || key == "__proto__" ||
  key == "prototype" || key == "constructor"
}

///|
fn bridge_api_key_valid(key : String) -> Bool {
  if key.length() == 0 || key.length() > 64 { return false }
  for i = 0; i < key.length(); i = i + 1 {
    let c = key[i].to_int()
    // The key becomes a page property name; reject control characters.
    if c == 0 || c < 32 || c == 127 { return false }
  }
  !bridge_api_key_reserved(key)
}

///|
fn bridge_sha256_valid(value : String) -> Bool {
  if value.length() != 64 { return false }
  for i = 0; i < value.length(); i = i + 1 {
    let c = value[i].to_int()
    let lower = c >= 48 && c <= 57
    let hex = c >= 97 && c <= 102
    if !lower && !hex { return false }
  }
  true
}

///|
pub fn Runtime::register_bridge_exposure(
  self : Runtime,
  window : Int32,
  generation : Int32,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  api_key : String,
  descriptor_bytes : Int32,
  function_count : Int32,
  descriptor_sha256 : String,
) -> Result[Int32, RuntimeError] {
  // Authority is checked before any quota, ID or map allocation.
  match self.authorize(window, generation, host_origin, main_frame, channel) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  if !bridge_api_key_valid(api_key) { return Err(InvalidPayload) }
  if !bridge_sha256_valid(descriptor_sha256) { return Err(InvalidPayload) }
  if descriptor_bytes < 1 { return Err(InvalidPayload) }
  if descriptor_bytes > 65536 { return Err(LimitExceeded) }
  if function_count < 0 { return Err(InvalidPayload) }
  if function_count > 256 { return Err(LimitExceeded) }
  for _, exposure in self.bridge_exposures {
    if exposure.window == window && exposure.generation == generation &&
      exposure.api_key == api_key {
      // Re-exposing the same page property in one document would make the
      // visible API ambiguous; fail closed instead of overwriting it, even
      // across internal channels.
      return Err(Denied)
    }
  }
  let mut document_count = 0
  for _, exposure in self.bridge_exposures {
    if exposure.window == window { document_count += 1 }
  }
  if document_count >= 32 { return Err(LimitExceeded) }
  if self.bridge_exposures.length() >= 128 { return Err(LimitExceeded) }
  if self.next_bridge_exposure == 2147483647 { return Err(IdExhausted) }
  let id = self.next_bridge_exposure
  self.next_bridge_exposure += 1
  self.bridge_exposures[id] = {
    window,
    generation,
    channel,
    api_key,
    descriptor_bytes,
    function_count,
    descriptor_sha256,
  }
  Ok(id)
}

///|
pub fn Runtime::validate_bridge_exposure(
  self : Runtime,
  window : Int32,
  generation : Int32,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  exposure_id : Int32,
  api_key : String,
) -> Result[Unit, RuntimeError] {
  match self.authorize(window, generation, host_origin, main_frame, channel) {
    Err(error) => return Err(error)
    Ok(_) => ()
  }
  match self.bridge_exposures.get(exposure_id) {
    None => Err(UnknownBridgeExposure)
    Some(exposure) => {
      if exposure.window != window || exposure.generation != generation ||
        exposure.channel != channel || exposure.api_key != api_key {
        return Err(Denied)
      }
      Ok(())
    }
  }
}

///|
pub fn Runtime::release_bridge_exposure(
  self : Runtime,
  window : Int32,
  generation : Int32,
  host_origin : String,
  main_frame : Bool,
  channel : String,
  exposure_id : Int32,
  api_key : String,
) -> Result[Bool, RuntimeError] {
  match self.validate_bridge_exposure(
    window, generation, host_origin, main_frame, channel, exposure_id, api_key,
  ) {
    Ok(_) => {
      self.bridge_exposures.remove(exposure_id)
      Ok(true)
    }
    Err(UnknownBridgeExposure) => Ok(false)
    Err(error) => Err(error)
  }
}

///|
fn Runtime::revoke_bridge_exposures(self : Runtime, window : Int32) -> Unit {
  let ids : Array[Int32] = []
  for id, exposure in self.bridge_exposures {
    if exposure.window == window { ids.push(id) }
  }
  for id in ids { self.bridge_exposures.remove(id) }
}

///|
pub fn Runtime::bridge_exposure_count(self : Runtime) -> Int {
  self.bridge_exposures.length()
}

///|
pub fn Runtime::bridge_exposure_metrics(
  self : Runtime,
  exposure_id : Int32,
) -> Option[(Int32, Int32, String)] {
  // Bounded diagnostics only; the descriptor body and JS functions stay in
  // their source realm.
  match self.bridge_exposures.get(exposure_id) {
    None => None
    Some(exposure) => Some((
      exposure.descriptor_bytes,
      exposure.function_count,
      exposure.descriptor_sha256,
    ))
  }
}
