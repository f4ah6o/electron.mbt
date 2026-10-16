///|
fn invoke_fixture() -> (Runtime, InvokeRegistry, Int32, Int32) {
  let (runtime, window, generation) = live_runtime()
  (runtime, InvokeRegistry::new(runtime), window, generation)
}

///|
fn claim(registry : InvokeRegistry, window : Int32, generation : Int32) -> (Int32, Int32, Bool) {
  match registry.begin(window, generation, "file:///fixture/", true, "read-text", 5) {
    Ok(value) => value
    Err(_) => abort("invoke claim failed")
  }
}

///|
test "handler registration precedes ready and duplicate rejection preserves the original id" {
  let runtime = Runtime::new()
  let registry = InvokeRegistry::new(runtime)
  assert_true(registry.register("read-text", false, true) is Ok(1))
  assert_true(registry.register("read-text", true, false) is Err(DuplicateHandler))
  assert_eq(registry.next_handler, 2)
  assert_true(registry.remove("missing") is Ok(0))
  assert_true(registry.remove("read-text") is Ok(1))
  assert_true(registry.register("read-text", true, true) is Ok(2))
}

///|
test "invalid channels callbacks and exhaustion do not reserve handler ids" {
  let registry = InvokeRegistry::new(Runtime::new())
  assert_true(registry.register("", false, true) is Err(CoreError(InvalidPayload)))
  assert_true(registry.register("valid", false, false) is Err(CoreError(InvalidPayload)))
  assert_eq(registry.next_handler, 1)
  registry.next_handler = 2147483646
  assert_true(registry.register("valid", false, true) is Ok(2147483646))
  assert_true(registry.register("next", false, true) is Err(CoreError(IdExhausted)))
}

///|
test "handler capacity is independent of ordinary listeners and released on removal" {
  let runtime = Runtime::new()
  let registry = InvokeRegistry::new(runtime)
  for index in 0..<128 {
    assert_true(registry.register("h\{index}", false, true) is Ok(_))
  }
  assert_true(registry.register("extra", false, true) is Err(CoreError(LimitExceeded)))
  assert_true(runtime.ipc_add_listener("extra") is Ok(_))
  registry.remove("h0") |> ignore
  assert_true(registry.register("extra", false, true) is Ok(129))
}

///|
test "registration does not grant renderer authority or disclose missing handlers" {
  let (runtime, registry, window, generation) = invoke_fixture()
  registry.register("ungranted", true, true) |> ignore
  for channel in ["ungranted", "missing"] {
    assert_true(registry.begin(window, generation, "file:///fixture/", true, channel, 5) is Err(CoreError(Denied)))
  }
  assert_eq(registry.handler_count(), 1)
  assert_eq(runtime.pending_count(), 0)
}

///|
test "foreign frames origins generations and oversized payloads preserve once handlers" {
  let (runtime, registry, window, generation) = invoke_fixture()
  registry.register("read-text", true, true) |> ignore
  assert_true(registry.begin(window, generation, "file:///fixture/", false, "read-text", 5) is Err(CoreError(Denied)))
  assert_true(registry.begin(window, generation, "https://foreign.invalid", true, "read-text", 5) is Err(CoreError(Denied)))
  assert_true(registry.begin(window, generation + 1, "file:///fixture/", true, "read-text", 5) is Err(CoreError(StaleDocument)))
  assert_true(registry.begin(window, generation, "file:///fixture/", true, "read-text", 1048577) is Err(CoreError(LimitExceeded)))
  assert_eq(runtime.pending_count(), 0)
  assert_eq(registry.handler_count(), 1)
  let (request, handler, once) = claim(registry, window, generation)
  assert_eq(handler, 1)
  assert_true(once)
  assert_eq(registry.handler_count(), 0)
  assert_true(registry.begin(window, generation, "file:///fixture/", true, "read-text", 5) is Err(UnknownHandler))
  assert_true(registry.finish(request) is Ok(_))
}

///|
test "inflight calls keep their ticket across handler replacement" {
  let (runtime, registry, window, generation) = invoke_fixture()
  registry.register("read-text", false, true) |> ignore
  let (old, old_handler, _) = claim(registry, window, generation)
  registry.remove("read-text") |> ignore
  registry.register("read-text", false, true) |> ignore
  let (next, next_handler, _) = claim(registry, window, generation)
  assert_true(next_handler > old_handler)
  assert_true(registry.finish(old) is Ok(_))
  assert_true(registry.finish(old) is Err(CoreError(AlreadyCompleted)))
  assert_eq(runtime.pending_count(), 1)
  assert_true(registry.finish(next) is Ok(_))
  assert_eq(runtime.queued_bytes(), 0)
}

///|
test "navigation rejects old results and acknowledges only owned cancellations" {
  let (runtime, registry, window, generation) = invoke_fixture()
  registry.register("read-text", false, true) |> ignore
  let (request, _, _) = claim(registry, window, generation)
  let other = match runtime.begin_request(window, generation, "file:///fixture/", true, "read-text", 7) {
    Ok(id) => id
    Err(_) => abort("other request failed")
  }
  runtime.navigate(window) |> ignore
  assert_true(registry.finish(request) is Err(CoreError(AlreadyCompleted)))
  assert_eq(registry.invocation_count(), 0)
  assert_eq(runtime.take_cancellations(), [other])
  assert_eq(runtime.queued_bytes(), 0)
}

///|
test "request capacity failure does not consume a once handler" {
  let (runtime, registry, window, generation) = invoke_fixture()
  registry.register("read-text", true, true) |> ignore
  for _ in 0..<256 {
    assert_true(runtime.begin_request(window, generation, "file:///fixture/", true, "read-text", 0) is Ok(_))
  }
  assert_true(registry.begin(window, generation, "file:///fixture/", true, "read-text", 0) is Err(CoreError(LimitExceeded)))
  assert_eq(registry.handler_count(), 1)
}

///|
test "drained cancellation notifications cannot bypass the separate invocation ticket limit" {
  let (runtime, registry, window, initial_generation) = invoke_fixture()
  registry.register("read-text", false, true) |> ignore
  let mut generation = initial_generation
  for _ in 0..<256 {
    claim(registry, window, generation) |> ignore
    generation = match runtime.navigate(window) {
      Ok(value) => value
      Err(_) => abort("navigate failed")
    }
    runtime.activate_document(window, generation, "file:///fixture/") |> ignore
    runtime.grant(window, generation, "read-text") |> ignore
    runtime.take_cancellations() |> ignore
  }
  assert_eq(runtime.pending_count(), 0)
  assert_eq(registry.invocation_count(), 256)
  assert_true(registry.begin(window, generation, "file:///fixture/", true, "read-text", 0) is Err(CoreError(LimitExceeded)))
  registry.dispose()
  assert_eq(registry.invocation_count(), 0)
}

///|
test "stopping and disposing reject late completions and clear both registries" {
  let (runtime, registry, window, generation) = invoke_fixture()
  registry.register("read-text", false, true) |> ignore
  let (request, _, _) = claim(registry, window, generation)
  runtime.stop()
  registry.dispose()
  registry.dispose()
  assert_eq(registry.invocation_count(), 0)
  assert_eq(registry.handler_count(), 0)
  assert_eq(runtime.take_cancellations(), [])
  assert_true(registry.finish(request) is Err(CoreError(AlreadyCompleted)))
  assert_true(registry.register("new", false, true) is Err(CoreError(InvalidState)))
}

///|
test "explicit cancel releases queue bytes without cancelling other calls" {
  let (runtime, registry, window, generation) = invoke_fixture()
  registry.register("read-text", false, true) |> ignore
  let (first, _, _) = claim(registry, window, generation)
  let (second, _, _) = claim(registry, window, generation)
  assert_true(registry.cancel(first))
  assert_false(registry.cancel(first))
  assert_eq(runtime.queued_bytes(), 5)
  assert_true(registry.finish(second) is Ok(_))
  assert_eq(runtime.queued_bytes(), 0)
}

///|
test "unknown request ids do not complete or cancel another services request" {
  let (runtime, registry, window, generation) = invoke_fixture()
  let other = match runtime.begin_request(window, generation, "file:///fixture/", true, "read-text", 7) {
    Ok(id) => id
    Err(_) => abort("other request failed")
  }
  assert_true(registry.finish(other) is Err(CoreError(UnknownRequest)))
  assert_false(registry.cancel(other))
  assert_eq(runtime.pending_count(), 1)
  assert_eq(runtime.queued_bytes(), 7)
}
