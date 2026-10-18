///|
fn bridge_test_window(runtime : Runtime) -> (Int32, Int32) {
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
  window : Int32,
  generation : Int32,
  kind : BridgeHandleKind,
) -> Int32 {
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
  let ids : Array[Int32] = []
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

///|
fn bridge_test_sha() -> String {
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}

///|
fn bridge_register(
  runtime : Runtime,
  window : Int32,
  generation : Int32,
  key : String,
  descriptor_bytes : Int32,
  function_count : Int32,
  descriptor_sha256 : String,
) -> Result[Int32, RuntimeError] {
  runtime.register_bridge_exposure(
    window,
    generation,
    "file:///fixture/",
    true,
    "read-text",
    key,
    descriptor_bytes,
    function_count,
    descriptor_sha256,
  )
}

///|
fn bridge_test_exposure(
  runtime : Runtime,
  window : Int32,
  generation : Int32,
  key : String,
) -> Int32 {
  match bridge_register(runtime, window, generation, key, 128, 2, bridge_test_sha()) {
    Ok(id) => id
    Err(_) => abort("bridge fixture exposure registration failed")
  }
}

///|
test "bridge exposures validate page names/descriptors and release without reuse" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_exposure(runtime, window, generation, "fixture")
  assert_eq(runtime.bridge_exposure_count(), 1)
  assert_eq(runtime.bridge_exposure_metrics(id), Some((128, 2, bridge_test_sha())))
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Ok(_))
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "other",
  ) is Err(Denied))
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", 99, "fixture",
  ) is Err(UnknownBridgeExposure))
  assert_eq(UnknownBridgeExposure.code(), "UnknownBridgeExposure")
  assert_true(runtime.release_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Ok(true))
  assert_true(runtime.release_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Ok(false))
  assert_eq(runtime.bridge_exposure_count(), 0)
  let next = bridge_test_exposure(runtime, window, generation, "fixture")
  assert_true(next > id)
}

///|
test "bridge exposure metadata rejects untrusted names sizes and authority" {
  let (runtime, window, generation) = live_runtime()
  let sha = bridge_test_sha()
  for key in ["", "window", "document", "globalThis", "process", "require",
    "module", "exports", "electron", "__proto__", "prototype", "constructor",
    "line\nbreak"] {
    assert_true(bridge_register(runtime, window, generation, key, 128, 2, sha) is Err(InvalidPayload))
  }
  assert_true(bridge_register(runtime, window, generation, "fixture", 0, 2, sha) is Err(InvalidPayload))
  assert_true(bridge_register(runtime, window, generation, "fixture", 65537, 2, sha) is Err(LimitExceeded))
  assert_true(bridge_register(runtime, window, generation, "fixture", 128, -1, sha) is Err(InvalidPayload))
  assert_true(bridge_register(runtime, window, generation, "fixture", 128, 257, sha) is Err(LimitExceeded))
  assert_true(bridge_register(runtime, window, generation, "fixture", 128, 2, "") is Err(InvalidPayload))
  assert_true(bridge_register(runtime, window, generation, "fixture", 128, 2, "f") is Err(InvalidPayload))
  // The helper fixes the origin, so check authority through the direct call.
  assert_true(runtime.register_bridge_exposure(
    window, generation, "https://attacker.invalid", true, "read-text", "fixture", 128, 2, sha,
  ) is Err(Denied))
  assert_true(runtime.register_bridge_exposure(
    window, generation, "file:///fixture/", false, "read-text", "fixture", 128, 2, sha,
  ) is Err(Denied))
  assert_true(runtime.register_bridge_exposure(
    window, generation, "file:///fixture/", true, "ungranted", "fixture", 128, 2, sha,
  ) is Err(Denied))
  assert_true(runtime.register_bridge_exposure(
    window, generation + 1, "file:///fixture/", true, "read-text", "fixture", 128, 2, sha,
  ) is Err(StaleDocument))
  assert_eq(runtime.bridge_exposure_count(), 0)
  assert_eq(runtime.next_bridge_exposure, 1)
}

///|
test "bridge exposures reject duplicate page names per document" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_exposure(runtime, window, generation, "fixture")
  assert_true(bridge_register(runtime, window, generation, "fixture", 128, 2, bridge_test_sha()) is Err(Denied))
  assert_eq(runtime.bridge_exposure_count(), 1)
  let next_generation = match runtime.navigate(window) {
    Ok(value) => value
    Err(_) => abort("bridge fixture navigation failed")
  }
  runtime.activate_document(window, next_generation, "file:///fixture/") |> ignore
  runtime.grant(window, next_generation, "read-text") |> ignore
  let next_id = bridge_test_exposure(runtime, window, next_generation, "fixture")
  assert_true(next_id > id)
  assert_eq(runtime.bridge_exposure_count(), 1)
}

///|
test "bridge exposure quotas bound one document and the runtime" {
  let (runtime, window, generation) = live_runtime()
  for index in 0..<32 {
    bridge_test_exposure(runtime, window, generation, "api" + index.to_string()) |> ignore
  }
  assert_eq(runtime.bridge_exposure_count(), 32)
  let next_id = runtime.next_bridge_exposure
  assert_true(bridge_register(runtime, window, generation, "api32", 128, 2, bridge_test_sha()) is Err(LimitExceeded))
  assert_eq(runtime.next_bridge_exposure, next_id)
  // Release restores one document slot; the released key can be reused by a
  // fresh exposure ID.
  assert_true(runtime.release_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", 1, "api0",
  ) is Ok(true))
  assert_eq(runtime.bridge_exposure_count(), 31)
  bridge_test_exposure(runtime, window, generation, "api32") |> ignore
  assert_eq(runtime.bridge_exposure_count(), 32)
}

///|
test "bridge exposure runtime quota spans documents and destroy restores capacity" {
  let runtime = Runtime::new()
  runtime.ready() |> ignore
  let mut first_window = 0
  for index in 0..<4 {
    let (window, generation) = bridge_test_window(runtime)
    if index == 0 { first_window = window }
    for slot in 0..<32 {
      bridge_test_exposure(runtime, window, generation, "api" + slot.to_string()) |> ignore
    }
  }
  let (window, generation) = bridge_test_window(runtime)
  assert_eq(runtime.bridge_exposure_count(), 128)
  assert_true(bridge_register(runtime, window, generation, "api0", 128, 2, bridge_test_sha()) is Err(LimitExceeded))
  runtime.destroy_window(first_window) |> ignore
  assert_eq(runtime.bridge_exposure_count(), 96)
  bridge_test_exposure(runtime, window, generation, "api0") |> ignore
  assert_eq(runtime.bridge_exposure_count(), 97)
}

///|
test "navigation invalidation destroy and stop revoke exposures" {
  let (runtime, window, generation) = live_runtime()
  bridge_test_exposure(runtime, window, generation, "fixture") |> ignore
  let next_generation = match runtime.navigate(window) {
    Ok(value) => value
    Err(_) => abort("bridge fixture navigation failed")
  }
  assert_eq(runtime.bridge_exposure_count(), 0)
  runtime.activate_document(window, next_generation, "file:///fixture/") |> ignore
  runtime.grant(window, next_generation, "read-text") |> ignore
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", 1, "fixture",
  ) is Err(StaleDocument))
  assert_true(runtime.validate_bridge_exposure(
    window, next_generation, "file:///fixture/", true, "read-text", 1, "fixture",
  ) is Err(UnknownBridgeExposure))
  bridge_test_exposure(runtime, window, next_generation, "fixture") |> ignore
  runtime.invalidate_document(window, next_generation) |> ignore
  assert_eq(runtime.bridge_exposure_count(), 0)
  assert_true(runtime.validate_bridge_exposure(
    window, next_generation, "file:///fixture/", true, "read-text", 2, "fixture",
  ) is Err(InvalidState))
  runtime.destroy_window(window) |> ignore
  assert_eq(runtime.bridge_exposure_count(), 0)
  runtime.stop()
  assert_eq(runtime.bridge_exposure_count(), 0)
}

///|
test "cancelled close/quit preserve exposures but deny use while closing" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_exposure(runtime, window, generation, "fixture")
  runtime.begin_close(window) |> ignore
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Err(InvalidState))
  assert_eq(runtime.bridge_exposure_count(), 1)
  runtime.cancel_close(window) |> ignore
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Ok(_))
  runtime.begin_quit() |> ignore
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Err(InvalidState))
  assert_eq(runtime.bridge_exposure_count(), 1)
  runtime.cancel_quit() |> ignore
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Ok(_))
}

///|
test "bridge exposure IDs never reuse a released slot and fail before overflow" {
  let (runtime, window, generation) = live_runtime()
  let first = bridge_test_exposure(runtime, window, generation, "fixture")
  runtime.release_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", first, "fixture",
  ) |> ignore
  let second = bridge_test_exposure(runtime, window, generation, "fixture")
  assert_true(second > first)
  runtime.release_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", second, "fixture",
  ) |> ignore
  runtime.next_bridge_exposure = 2147483646
  let last = bridge_test_exposure(runtime, window, generation, "fixture")
  assert_eq(last, 2147483646)
  runtime.release_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", last, "fixture",
  ) |> ignore
  assert_true(bridge_register(runtime, window, generation, "fixture", 128, 2, bridge_test_sha()) is Err(IdExhausted))
  assert_eq(runtime.next_bridge_exposure, 2147483647)
}

///|
test "failed stale transitions leave current exposures intact" {
  let (runtime, window, generation) = live_runtime()
  let id = bridge_test_exposure(runtime, window, generation, "fixture")
  assert_true(runtime.invalidate_document(window, generation + 1) is Err(StaleDocument))
  assert_eq(runtime.bridge_exposure_count(), 1)
  assert_true(runtime.navigate(window + 1) is Err(UnknownWindow))
  assert_eq(runtime.bridge_exposure_count(), 1)
  assert_true(runtime.validate_bridge_exposure(
    window, generation, "file:///fixture/", true, "read-text", id, "fixture",
  ) is Ok(_))
}
