///|
fn bridge_test_window(runtime : Runtime) -> (Int, Int) {
  let window = match runtime.reserve_window() {
    Ok(id) => id
    Err(_) => abort("bridge fixture window reservation failed")
  }
  runtime.confirm_window(window) |> ignore
  let generation = match runtime.navigate(window) {
    Ok(value) => value
    Err(_) => abort("bridge fixture navigation failed")
  }
  runtime.activate_document(window, generation, "file:///fixture/") |> ignore
  runtime.grant(window, generation, "read-text") |> ignore
  (window, generation)
}

///|
fn bridge_test_handle(
  runtime : Runtime,
  window : Int,
  generation : Int,
  kind : BridgeHandleKind,
) -> Int {
  match runtime.register_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", kind,
  ) {
    Ok(id) => id
    Err(_) => abort("bridge fixture handle registration failed")
  }
}

///|
test "bridge handles are typed and unknown IDs do not resolve" {
  let (runtime, window, generation) = live_runtime()
  let kinds = [FunctionProxy, CallbackProxy, PromiseProxy]
  for kind in kinds {
    let id = bridge_test_handle(runtime, window, generation, kind)
    for expected in kinds {
      let result = runtime.validate_bridge_handle(
        window, generation, "file:///fixture/", true, "read-text", id, expected,
      )
      if kind == expected { assert_true(result is Ok(_)) } else {
        assert_true(result is Err(Denied))
      }
    }
  }
  assert_eq(runtime.bridge_handle_count(), 3)
  for id in [-1, 0, 2147483647] {
    assert_true(runtime.validate_bridge_handle(
      window, generation, "file:///fixture/", true, "read-text", id, FunctionProxy,
    ) is Err(UnknownBridgeHandle))
  }
  assert_eq(UnknownBridgeHandle.code(), "UnknownBridgeHandle")
}

///|
test "bridge registration rejects untrusted metadata without allocating IDs" {
  let (runtime, window, generation) = live_runtime()
  assert_true(runtime.register_bridge_handle(
    window, generation, "https://attacker.invalid", true, "read-text", FunctionProxy,
  ) is Err(Denied))
  assert_true(runtime.register_bridge_handle(
    window, generation, "file:///fixture/", false, "read-text", CallbackProxy,
  ) is Err(Denied))
  assert_true(runtime.register_bridge_handle(
    window, generation, "file:///fixture/", true, "ungranted", PromiseProxy,
  ) is Err(Denied))
  assert_true(runtime.register_bridge_handle(
    window, generation + 1, "file:///fixture/", true, "read-text", FunctionProxy,
  ) is Err(StaleDocument))
  assert_true(runtime.register_bridge_handle(
    window + 1, generation, "file:///fixture/", true, "read-text", FunctionProxy,
  ) is Err(UnknownWindow))
  assert_eq(runtime.bridge_handle_count(), 0)
  assert_eq(runtime.next_bridge_handle, 1)
}

///|
test "bridge use disposal and settlement all recheck origin and frame" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, PromiseProxy)
  for origin in ["https://attacker.invalid", "file:///fixture/"] {
    let main_frame = origin != "file:///fixture/"
    assert_true(runtime.validate_bridge_handle(
      window, generation, origin, main_frame, "read-text", id, PromiseProxy,
    ) is Err(Denied))
    assert_true(runtime.release_bridge_handle(
      window, generation, origin, main_frame, "read-text", id, PromiseProxy,
    ) is Err(Denied))
    assert_true(runtime.settle_bridge_promise(
      window, generation, origin, main_frame, "read-text", id,
    ) is Err(Denied))
  }
  assert_eq(runtime.bridge_handle_count(), 1)
}

///|
test "another granted channel cannot borrow or dispose a bridge handle" {
  let (runtime, window, generation) = live_runtime()
  runtime.grant(window, generation, "write-text") |> ignore
  let id = bridge_test_handle(runtime, window, generation, PromiseProxy)
  for channel in ["write-text", "ungranted"] {
    assert_true(runtime.validate_bridge_handle(
      window, generation, "file:///fixture/", true, channel, id, PromiseProxy,
    ) is Err(Denied))
    assert_true(runtime.release_bridge_handle(
      window, generation, "file:///fixture/", true, channel, id, PromiseProxy,
    ) is Err(Denied))
    assert_true(runtime.settle_bridge_promise(
      window, generation, "file:///fixture/", true, channel, id,
    ) is Err(Denied))
  }
  assert_eq(runtime.bridge_handle_count(), 1)
}

///|
test "a live same-origin window cannot borrow another windows handle" {
  let (runtime, window, generation) = live_runtime()
  let (other, other_generation) = bridge_test_window(runtime)
  let id = bridge_test_handle(runtime, window, generation, PromiseProxy)
  assert_true(runtime.validate_bridge_handle(
    other, other_generation, "file:///fixture/", true, "read-text", id, PromiseProxy,
  ) is Err(Denied))
  assert_true(runtime.release_bridge_handle(
    other, other_generation, "file:///fixture/", true, "read-text", id, PromiseProxy,
  ) is Err(Denied))
  assert_true(runtime.settle_bridge_promise(
    other, other_generation, "file:///fixture/", true, "read-text", id,
  ) is Err(Denied))
  assert_eq(runtime.bridge_handle_count(), 1)
}

///|
test "bridge disposal is idempotent without recycling identity" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, CallbackProxy)
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, FunctionProxy,
  ) is Err(Denied))
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, CallbackProxy,
  ) is Ok(true))
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, CallbackProxy,
  ) is Ok(false))
  let next = bridge_test_handle(runtime, window, generation, CallbackProxy)
  assert_true(next > id)
  assert_true(runtime.validate_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, CallbackProxy,
  ) is Err(UnknownBridgeHandle))
  assert_eq(runtime.bridge_handle_count(), 1)
}

///|
test "even an absent bridge handle requires current authority for disposal" {
  let (runtime, window, generation) = live_runtime()
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", false, "read-text", 99, CallbackProxy,
  ) is Err(Denied))
  assert_true(runtime.release_bridge_handle(
    window, generation + 1, "file:///fixture/", true, "read-text", 99, CallbackProxy,
  ) is Err(StaleDocument))
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", true, "ungranted", 99, CallbackProxy,
  ) is Err(Denied))
}

///|
test "bridge Promise settlement consumes identity before any repeated delivery" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, PromiseProxy)
  assert_true(runtime.settle_bridge_promise(
    window, generation, "file:///fixture/", true, "read-text", id,
  ) is Ok(_))
  assert_eq(runtime.bridge_handle_count(), 0)
  assert_true(runtime.settle_bridge_promise(
    window, generation, "file:///fixture/", true, "read-text", id,
  ) is Err(UnknownBridgeHandle))
  assert_true(runtime.validate_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, PromiseProxy,
  ) is Err(UnknownBridgeHandle))
}

///|
test "Promise settlement cannot consume a function or callback" {
  let (runtime, window, generation) = live_runtime()
  for kind in [FunctionProxy, CallbackProxy] {
    let id = bridge_test_handle(runtime, window, generation, kind)
    assert_true(runtime.settle_bridge_promise(
      window, generation, "file:///fixture/", true, "read-text", id,
    ) is Err(Denied))
    assert_true(runtime.validate_bridge_handle(
      window, generation, "file:///fixture/", true, "read-text", id, kind,
    ) is Ok(_))
  }
  assert_eq(runtime.bridge_handle_count(), 2)
}

///|
test "navigation revokes every kind and old IDs cannot target the new document" {
  let (runtime, window, generation) = live_runtime()
  let kinds = [FunctionProxy, CallbackProxy, PromiseProxy]
  let ids : Array[Int] = []
  for kind in kinds { ids.push(bridge_test_handle(runtime, window, generation, kind)) }
  assert_true(runtime.navigate(window) is Ok(_))
  assert_eq(runtime.bridge_handle_count(), 0)
  let next_generation = generation + 1
  runtime.activate_document(window, next_generation, "file:///fixture/") |> ignore
  runtime.grant(window, next_generation, "read-text") |> ignore
  for index in 0..<3 {
    assert_true(runtime.validate_bridge_handle(
      window, generation, "file:///fixture/", true, "read-text", ids[index], kinds[index],
    ) is Err(StaleDocument))
    assert_true(runtime.validate_bridge_handle(
      window, next_generation, "file:///fixture/", true, "read-text", ids[index], kinds[index],
    ) is Err(UnknownBridgeHandle))
  }
  let fresh = bridge_test_handle(runtime, window, next_generation, FunctionProxy)
  assert_true(fresh > ids[2])
  assert_true(runtime.settle_bridge_promise(
    window, generation, "file:///fixture/", true, "read-text", ids[2],
  ) is Err(StaleDocument))
  assert_eq(runtime.bridge_handle_count(), 1)
}

///|
test "reactivating the same invalidated generation cannot resurrect bridge handles" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, CallbackProxy)
  assert_true(runtime.invalidate_document(window, generation) is Ok(_))
  assert_eq(runtime.bridge_handle_count(), 0)
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, CallbackProxy,
  ) is Err(InvalidState))
  assert_true(runtime.activate_document(window, generation, "file:///fixture/") is Ok(_))
  runtime.grant(window, generation, "read-text") |> ignore
  assert_true(runtime.validate_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, CallbackProxy,
  ) is Err(UnknownBridgeHandle))
  assert_true(bridge_test_handle(runtime, window, generation, CallbackProxy) > id)
}

///|
test "destroy revokes only its own windows bridge handles" {
  let (runtime, window, generation) = live_runtime()
  let (other, other_generation) = bridge_test_window(runtime)
  bridge_test_handle(runtime, window, generation, FunctionProxy) |> ignore
  let kept = bridge_test_handle(runtime, other, other_generation, CallbackProxy)
  assert_true(runtime.destroy_window(window))
  assert_false(runtime.destroy_window(window))
  assert_eq(runtime.bridge_handle_count(), 1)
  assert_true(runtime.validate_bridge_handle(
    other, other_generation, "file:///fixture/", true, "read-text", kept, CallbackProxy,
  ) is Ok(_))
}

///|
test "stop revokes every bridge handle and cannot restore authority" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, PromiseProxy)
  runtime.stop()
  runtime.stop()
  assert_eq(runtime.bridge_handle_count(), 0)
  assert_true(runtime.settle_bridge_promise(
    window, generation, "file:///fixture/", true, "read-text", id,
  ) is Err(InvalidState))
  assert_true(runtime.ready() is Err(InvalidState))
}

///|
test "cancelled close preserves document handles but denies use while closing" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, CallbackProxy)
  runtime.begin_close(window) |> ignore
  assert_true(runtime.validate_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, CallbackProxy,
  ) is Err(InvalidState))
  assert_eq(runtime.bridge_handle_count(), 1)
  runtime.cancel_close(window) |> ignore
  assert_true(runtime.validate_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, CallbackProxy,
  ) is Ok(_))
}

///|
test "cancelled quit preserves handles but does not permit Promise settlement while quitting" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, PromiseProxy)
  runtime.begin_quit() |> ignore
  assert_true(runtime.settle_bridge_promise(
    window, generation, "file:///fixture/", true, "read-text", id,
  ) is Err(InvalidState))
  assert_eq(runtime.bridge_handle_count(), 1)
  runtime.cancel_quit() |> ignore
  assert_true(runtime.settle_bridge_promise(
    window, generation, "file:///fixture/", true, "read-text", id,
  ) is Ok(_))
}

///|
test "the document handle quota covers every kind and release restores capacity" {
  let (runtime, window, generation) = live_runtime()
  let kinds = [FunctionProxy, CallbackProxy, PromiseProxy]
  let mut first = 0
  for index in 0..<256 {
    let id = bridge_test_handle(runtime, window, generation, kinds[index % 3])
    if index == 0 { first = id }
  }
  let next_id = runtime.next_bridge_handle
  assert_true(runtime.register_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", CallbackProxy,
  ) is Err(LimitExceeded))
  assert_eq(runtime.next_bridge_handle, next_id)
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", first, FunctionProxy,
  ) is Ok(true))
  assert_true(bridge_test_handle(runtime, window, generation, PromiseProxy) > first)
  assert_eq(runtime.bridge_handle_count(), 256)
}

///|
test "the runtime quota bounds many documents and destroy restores capacity" {
  let runtime = Runtime::new()
  runtime.ready() |> ignore
  let mut first_window = 0
  for index in 0..<16 {
    let (window, generation) = bridge_test_window(runtime)
    if index == 0 { first_window = window }
    for _ in 0..<256 {
      bridge_test_handle(runtime, window, generation, FunctionProxy) |> ignore
    }
  }
  let (window, generation) = bridge_test_window(runtime)
  assert_eq(runtime.bridge_handle_count(), 4096)
  let next_id = runtime.next_bridge_handle
  assert_true(runtime.register_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", FunctionProxy,
  ) is Err(LimitExceeded))
  assert_eq(runtime.next_bridge_handle, next_id)
  runtime.destroy_window(first_window) |> ignore
  assert_eq(runtime.bridge_handle_count(), 3840)
  assert_eq(bridge_test_handle(runtime, window, generation, FunctionProxy), next_id)
}

///|
test "bridge identity exhaustion fails before overflow and never reuses released IDs" {
  let (runtime, window, generation) = live_runtime()
  runtime.next_bridge_handle = 2147483646
  let id = bridge_test_handle(runtime, window, generation, FunctionProxy)
  assert_eq(id, 2147483646)
  assert_true(runtime.release_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, FunctionProxy,
  ) is Ok(true))
  assert_true(runtime.register_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", FunctionProxy,
  ) is Err(IdExhausted))
  assert_eq(runtime.next_bridge_handle, 2147483647)
  assert_eq(runtime.bridge_handle_count(), 0)
}

///|
test "failed stale invalidation and failed navigation leave current handles intact" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_handle(runtime, window, generation, FunctionProxy)
  assert_true(runtime.invalidate_document(window, generation + 1) is Err(StaleDocument))
  assert_false(runtime.destroy_window(window + 1))
  runtime.begin_close(window) |> ignore
  assert_true(runtime.navigate(window) is Err(InvalidState))
  runtime.cancel_close(window) |> ignore
  assert_eq(runtime.bridge_handle_count(), 1)
  assert_true(runtime.validate_bridge_handle(
    window, generation, "file:///fixture/", true, "read-text", id, FunctionProxy,
  ) is Ok(_))
}

///|
test "repeated document revocation stays bounded and IDs keep increasing" {
  let (runtime, window, generation) = live_runtime()
  let mut previous = 0
  for _ in 0..<1024 {
    let id = bridge_test_handle(runtime, window, generation, CallbackProxy)
    assert_true(id > previous)
    previous = id
    assert_true(runtime.invalidate_document(window, generation) is Ok(_))
    assert_eq(runtime.bridge_handle_count(), 0)
    runtime.activate_document(window, generation, "file:///fixture/") |> ignore
    runtime.grant(window, generation, "read-text") |> ignore
  }
}
