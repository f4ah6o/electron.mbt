///|
fn dispatch_ipc_listeners(runtime : @core.Runtime, value : Json) -> String {
  match text(value, "op") {
    "ipc.listeners.add" =>
      match arg_text(value, "channel") {
        Ok(channel) =>
          match runtime.ipc_add_listener(channel) {
            Ok(id) => respond([("listener", id.to_json())])
            Err(error) => code_result(Err(error))
          }
        Err(error) => code_result(Err(error))
      }
    "ipc.listeners.snapshot" =>
      match arg_text(value, "channel") {
        Ok(channel) =>
          match runtime.ipc_listener_snapshot(channel) {
            Ok(ids) => respond([("listeners", ids.to_json())])
            Err(error) => code_result(Err(error))
          }
        Err(error) => code_result(Err(error))
      }
    "ipc.listeners.remove" =>
      match arg_int(value, "listener") {
        Ok(id) =>
          match runtime.ipc_remove_listener(id) {
            Ok(removed) => respond([("removed", removed.to_json())])
            Err(error) => code_result(Err(error))
          }
        Err(error) => code_result(Err(error))
      }
    "ipc.listeners.clear-channel" =>
      match arg_text(value, "channel") {
        Ok(channel) =>
          match runtime.ipc_clear_listeners(Some(channel)) {
            Ok(ids) => respond([("listeners", ids.to_json())])
            Err(error) => code_result(Err(error))
          }
        Err(error) => code_result(Err(error))
      }
    "ipc.listeners.clear-all" =>
      match runtime.ipc_clear_listeners(None) {
        Ok(ids) => respond([("listeners", ids.to_json())])
        Err(error) => code_result(Err(error))
      }
    _ => "{\"ok\":false,\"code\":\"ELECTRON_MBT_UNSUPPORTED_API\"}"
  }
}
