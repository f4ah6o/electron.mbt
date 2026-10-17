///|
pub fn Runtime::contains_bridge_handle(self : Runtime, id : Int32) -> Bool {
  // Cleanup must not confuse a cancelled close/quit with document revocation.
  self.bridge_handles.contains(id)
}
