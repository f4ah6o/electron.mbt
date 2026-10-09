///|
fn live_runtime() -> (Runtime, Int, Int) {
  let runtime = Runtime::new()
  runtime.ready() |> ignore
  let id = match runtime.reserve_window() {
    Ok(id) => id
    Err(_) => abort("fixture window reservation failed")
  }
  runtime.confirm_window(id) |> ignore
  let generation = match runtime.navigate(id) {
    Ok(generation) => generation
    Err(_) => abort("fixture navigation failed")
  }
  runtime.activate_document(id, generation, "file:///fixture/") |> ignore
  runtime.grant(id, generation, "read-text") |> ignore
  (runtime, id, generation)
}

///|
test "window creation requires ready and native acknowledgement" {
  let runtime = Runtime::new()
  assert_true(runtime.reserve_window() is Err(InvalidState))
  assert_true(runtime.ready() is Ok(_))
  assert_true(runtime.ready() is Err(InvalidState))
  let id = match runtime.reserve_window() {
    Ok(id) => id
    Err(_) => abort("reserve failed")
  }
  assert_true(runtime.window_state(id) is Ok(Creating))
  assert_true(runtime.begin_close(id) is Err(InvalidState))
  assert_true(runtime.confirm_window(id) is Ok(_))
  assert_true(runtime.confirm_window(id) is Err(InvalidState))
  assert_true(runtime.window_state(id) is Ok(Live))
}

///|
test "close and quit cancellations restore live states" {
  let (runtime, id, _) = live_runtime()
  assert_true(runtime.begin_close(id) is Ok(_))
  assert_true(runtime.begin_close(id) is Err(InvalidState))
  assert_true(runtime.cancel_close(id) is Ok(_))
  assert_true(runtime.window_state(id) is Ok(Live))
  assert_true(runtime.begin_quit() is Ok(_))
  assert_true(runtime.reserve_window() is Err(InvalidState))
  assert_true(runtime.cancel_quit() is Ok(_))
  assert_true(runtime.app_state() == Ready)
}

///|
test "destroy is idempotent and identifiers are never reused" {
  let (runtime, id, _) = live_runtime()
  assert_true(runtime.destroy_window(id))
  assert_false(runtime.destroy_window(id))
  assert_true(runtime.window_state(id) is Err(UnknownWindow))
  let next = match runtime.reserve_window() {
    Ok(id) => id
    Err(_) => abort("reserve failed")
  }
  assert_true(next > id)
}

///|
test "ungranted channels foreign origins and child frames are denied" {
  let (runtime, id, generation) = live_runtime()
  assert_true(runtime.authorize(id, generation, "file:///fixture/", true, "read-text") is Ok(_))
  assert_true(runtime.authorize(id, generation, "https://example.invalid", true, "read-text") is Err(Denied))
  assert_true(runtime.authorize(id, generation, "file:///fixture/", false, "read-text") is Err(Denied))
  assert_true(runtime.authorize(id, generation, "file:///fixture/", true, "write-text") is Err(Denied))
}

///|
test "navigation invalidates grants senders and pending requests" {
  let (runtime, id, generation) = live_runtime()
  let request = match runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 17) {
    Ok(id) => id
    Err(_) => abort("request failed")
  }
  let next = match runtime.navigate(id) {
    Ok(generation) => generation
    Err(_) => abort("navigate failed")
  }
  assert_true(next > generation)
  assert_eq(runtime.pending_count(), 0)
  assert_eq(runtime.queued_bytes(), 0)
  assert_true(runtime.activate_document(id, generation, "file:///fixture/") is Err(StaleDocument))
  assert_true(runtime.activate_document(id, next, "file:///fixture/") is Ok(_))
  assert_true(runtime.authorize(id, generation, "file:///fixture/", true, "read-text") is Err(StaleDocument))
  assert_true(runtime.authorize(id, next, "file:///fixture/", true, "read-text") is Err(Denied))
  assert_true(runtime.complete_request(request, id, generation) is Err(AlreadyCompleted))
  assert_eq(runtime.take_cancellations(), [request])
  assert_eq(runtime.take_cancellations().length(), 0)
}

///|
test "completion is correlated and terminal exactly once" {
  let (runtime, id, generation) = live_runtime()
  let request = match runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 10) {
    Ok(id) => id
    Err(_) => abort("request failed")
  }
  assert_true(runtime.complete_request(request, id + 1, generation) is Err(StaleDocument))
  assert_eq(runtime.pending_count(), 1)
  assert_true(runtime.complete_request(request, id, generation) is Ok(_))
  assert_true(runtime.complete_request(request, id, generation) is Err(AlreadyCompleted))
  assert_eq(runtime.queued_bytes(), 0)
}

///|
test "queue byte limits are checked before adding pending work" {
  let (runtime, id, generation) = live_runtime()
  assert_true(runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", -1) is Err(LimitExceeded))
  assert_true(runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 1048577) is Err(LimitExceeded))
  for _ in 0..<4 {
    assert_true(runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 1048576) is Ok(_))
  }
  assert_true(runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 1) is Err(LimitExceeded))
  assert_eq(runtime.queued_bytes(), 4194304)
}

///|
test "pending and undelivered cancellation counts remain bounded" {
  let (runtime, id, generation) = live_runtime()
  for _ in 0..<256 {
    assert_true(runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 0) is Ok(_))
  }
  assert_true(runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 0) is Err(LimitExceeded))
  runtime.navigate(id) |> ignore
  runtime.activate_document(id, generation + 1, "file:///fixture/") |> ignore
  runtime.grant(id, generation + 1, "read-text") |> ignore
  assert_true(runtime.begin_request(id, generation + 1, "file:///fixture/", true, "read-text", 0) is Err(LimitExceeded))
  assert_eq(runtime.take_cancellations().length(), 256)
  assert_true(runtime.begin_request(id, generation + 1, "file:///fixture/", true, "read-text", 0) is Ok(_))
}

///|
test "shutdown cancels outstanding work and cannot be reopened" {
  let (runtime, id, generation) = live_runtime()
  runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 20) |> ignore
  runtime.stop()
  runtime.stop()
  assert_eq(runtime.pending_count(), 0)
  assert_eq(runtime.queued_bytes(), 0)
  assert_eq(runtime.take_cancellations().length(), 1)
  assert_true(runtime.ready() is Err(InvalidState))
  assert_true(runtime.reserve_window() is Err(InvalidState))
  assert_false(runtime.destroy_window(id))
}

///|
test "creation and identifiers have hard bounds" {
  let runtime = Runtime::new()
  runtime.ready() |> ignore
  for _ in 0..<64 { assert_true(runtime.reserve_window() is Ok(_)) }
  assert_true(runtime.reserve_window() is Err(LimitExceeded))
  runtime.destroy_window(1) |> ignore
  runtime.next_window = 2147483647
  assert_true(runtime.reserve_window() is Err(IdExhausted))
}

///|
test "document activation cannot change an active origins authority" {
  let (runtime, id, generation) = live_runtime()
  assert_true(runtime.activate_document(id, generation, "https://attacker.invalid") is Err(InvalidState))
  runtime.navigate(id) |> ignore
  assert_true(runtime.activate_document(id, generation + 1, "null") is Err(Denied))
  assert_true(runtime.activate_document(id, generation + 1, "") is Err(Denied))
}

///|
test "insecure web preferences never silently downgrade" {
  assert_true(validate_preferences(false, true, true, true))
  assert_false(validate_preferences(true, true, true, true))
  assert_false(validate_preferences(false, false, true, true))
  assert_false(validate_preferences(false, true, false, true))
  assert_false(validate_preferences(false, true, true, false))
}

///|
test "bounded tiny JSON profile rejects deep values" {
  assert_true(validate_json(@json.parse("{\"text\":\"日本語\",\"items\":[null,true,1]}")))
  let mut value : Json = null
  for _ in 0..<65 { value = [value].to_json() }
  assert_false(validate_json(value))
}

///|
test "terminal history stays bounded under repeated successful requests" {
  let (runtime, id, generation) = live_runtime()
  for _ in 0..<2048 {
    let request = match runtime.begin_request(id, generation, "file:///fixture/", true, "read-text", 1) {
      Ok(id) => id
      Err(_) => abort("request failed")
    }
    assert_true(runtime.complete_request(request, id, generation) is Ok(_))
  }
  assert_eq(runtime.terminal.length(), 1024)
  assert_eq(runtime.pending_count(), 0)
  assert_eq(runtime.queued_bytes(), 0)
  assert_true(runtime.complete_request(1, id, generation) is Err(UnknownRequest))
}

///|
test "negative zero is rejected instead of losing its sign" {
  assert_false(validate_json(@json.parse("-0")))
  assert_true(validate_json(@json.parse("0")))
}
