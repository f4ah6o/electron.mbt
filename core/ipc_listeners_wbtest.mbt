///|
fn listener_id(runtime : Runtime, channel : String) -> Int32 {
  match runtime.ipc_add_listener(channel) {
    Ok(id) => id
    Err(_) => abort("listener registration failed")
  }
}

///|
fn listener_ids(runtime : Runtime, channel : String) -> Array[Int32] {
  match runtime.ipc_listener_snapshot(channel) {
    Ok(ids) => ids
    Err(_) => abort("listener snapshot failed")
  }
}

///|
test "main listeners can be registered before ready and preserve duplicate order" {
  let runtime = Runtime::new()
  let first = listener_id(runtime, "message")
  let other = listener_id(runtime, "other")
  let second = listener_id(runtime, "message")
  assert_eq(listener_ids(runtime, "message"), [first, second])
  assert_eq(listener_ids(runtime, "other"), [other])
  assert_true(runtime.ready() is Ok(_))
  assert_eq(listener_ids(runtime, "message"), [first, second])
}

///|
test "removing a listener preserves snapshots and never reuses its id" {
  let runtime = Runtime::new()
  let first = listener_id(runtime, "message")
  let second = listener_id(runtime, "message")
  let before = listener_ids(runtime, "message")
  assert_true(runtime.ipc_remove_listener(first) is Ok(true))
  assert_true(runtime.ipc_remove_listener(first) is Ok(false))
  assert_true(runtime.ipc_remove_listener(0) is Err(InvalidPayload))
  assert_eq(before, [first, second])
  let third = listener_id(runtime, "message")
  assert_true(third > second)
  assert_eq(listener_ids(runtime, "message"), [second, third])
}

///|
test "listener capacity is global and a rejected addition consumes no id" {
  let runtime = Runtime::new()
  for _ in 0..<256 {
    listener_id(runtime, "message") |> ignore
  }
  let next = runtime.next_listener
  assert_true(runtime.ipc_add_listener("other") is Err(LimitExceeded))
  assert_eq(runtime.next_listener, next)
  assert_true(runtime.ipc_remove_listener(1) is Ok(true))
  assert_eq(listener_id(runtime, "other"), next)
}

///|
test "empty and special emitter channels are rejected without mutation" {
  let runtime = Runtime::new()
  assert_true(runtime.ipc_add_listener("") is Err(InvalidPayload))
  for channel in ["error", "newListener", "removeListener"] {
    assert_true(runtime.ipc_add_listener(channel) is Err(Denied))
    assert_true(runtime.ipc_listener_snapshot(channel) is Err(Denied))
    assert_true(runtime.ipc_clear_listeners(Some(channel)) is Err(Denied))
  }
  assert_eq(runtime.next_listener, 1)
  assert_eq(runtime.ipc_listeners.length(), 0)
}

///|
test "clearing one channel retains other callbacks and clearing all returns their ids" {
  let runtime = Runtime::new()
  let first = listener_id(runtime, "message")
  let other = listener_id(runtime, "other")
  let second = listener_id(runtime, "message")
  match runtime.ipc_clear_listeners(Some("message")) {
    Ok(ids) => assert_eq(ids, [first, second])
    Err(_) => abort("channel clear failed")
  }
  assert_eq(listener_ids(runtime, "other"), [other])
  match runtime.ipc_clear_listeners(None) {
    Ok(ids) => assert_eq(ids, [other])
    Err(_) => abort("clear all failed")
  }
  assert_eq(runtime.ipc_listeners.length(), 0)
}

///|
test "stop clears main listeners and prevents reuse of the stopped registry" {
  let runtime = Runtime::new()
  let id = listener_id(runtime, "message")
  runtime.stop()
  assert_eq(runtime.ipc_listeners.length(), 0)
  assert_true(runtime.ipc_add_listener("message") is Err(InvalidState))
  assert_true(runtime.ipc_listener_snapshot("message") is Err(InvalidState))
  assert_true(runtime.ipc_remove_listener(id) is Err(InvalidState))
  assert_true(runtime.ipc_clear_listeners(None) is Err(InvalidState))
}

///|
test "listener identifier exhaustion rejects rather than wrapping" {
  let runtime = Runtime::new()
  runtime.next_listener = 2147483646
  assert_eq(listener_id(runtime, "message"), 2147483646)
  assert_true(runtime.ipc_add_listener("message") is Err(IdExhausted))
  assert_eq(runtime.ipc_listeners.length(), 1)
}

///|
test "main registration grants no renderer authority and survives document replacement" {
  let (runtime, window, generation) = live_runtime()
  let id = listener_id(runtime, "ungranted")
  assert_true(
    runtime.authorize(window, generation, "file:///fixture/", true, "ungranted")
    is Err(Denied),
  )
  runtime.navigate(window) |> ignore
  assert_eq(listener_ids(runtime, "ungranted"), [id])
  runtime.destroy_window(window) |> ignore
  assert_eq(listener_ids(runtime, "ungranted"), [id])
}

///|
test "cancelled quit preserves application listeners" {
  let runtime = Runtime::new()
  runtime.ready() |> ignore
  let id = listener_id(runtime, "message")
  runtime.begin_quit() |> ignore
  assert_eq(listener_ids(runtime, "message"), [id])
  runtime.cancel_quit() |> ignore
  assert_eq(listener_ids(runtime, "message"), [id])
}
