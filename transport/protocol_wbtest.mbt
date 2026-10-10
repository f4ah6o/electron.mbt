///|
fn wire(id : String, payload : String, suffix : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":" + id + ",\"window\":2,\"generation\":3,\"operation\":\"show-window\",\"payload\":" + payload + suffix + "}"
}

///|
test "What: the MoonBit parser validates unchanged Unicode envelopes" {
  assert_true(validate(wire("1", "{\"text\":\"日本語😀\",\"items\":[true,null,1.5]}", "")) is Ok(_))
  assert_true(validate(wire("1", "{}", ",\"terminal\":\"success\"")) is Ok(_))
}

///|
test "What: duplicate decoded names fail in every object scope" {
  assert_true(validate(wire("1", "{}", ",\"operation\":\"show-window\"")) is Err(_))
  assert_true(validate(wire("1", "{}", ",\"\\u006fperation\":\"show-window\"")) is Err(_))
  assert_true(validate(wire("1", "{\"nested\":{\"a\":1,\"\\u0061\":2}}", "")) is Err(_))
  assert_true(validate(wire("1", "{\"a\":{\"same\":1},\"b\":{\"same\":2}}", "")) is Ok(_))
}

///|
test "What: malformed grammar and nonfinite or unsafe payloads fail closed" {
  for payload in ["{\"x\":1,}", "{\"x\":[1,]}", "{\"x\":1e400}", "{\"x\":-0}", "{\"constructor\":1}", "{\"x\":\"\\ud800\"}"] {
    assert_true(validate(wire("1", payload, "")) is Err(_))
  }
  assert_true(validate(wire("1", "{}", "") + " trailing") is Err(_))
  assert_true(validate(wire("1.5", "{}", "")) is Err(_))
  assert_true(validate(wire("-0", "{}", "")) is Err(_))
}

///|
test "What: deep wire is rejected before recursive library parsing" {
  let mut payload = "0"
  for i = 0; i < 66; i = i + 1 { payload = "{\"child\":" + payload + "}" }
  assert_true(validate(wire("1", payload, "")) is Err(_))
}

///|
test "What: sessions retain pending work on invalid or unknown completions" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(wire("1", "{}", "")) is Ok(_))
  assert_true(session.accept(wire("2", "{}", ",\"terminal\":\"success\"")) is Err(_))
  assert_true(session.accept(wire("1", "{}", ",\"operation\":\"show-window\",\"terminal\":\"success\"")) is Err(_))
  assert_eq(session.pending_count(), 1)
  assert_true(session.accept(wire("1", "{}", ",\"terminal\":\"success\"")) is Ok(_))
  assert_eq(session.pending_count(), 0)
}

///|
test "What: completion and cancellation never release an issued ID for reuse" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(wire("1", "{}", "")) is Ok(_))
  assert_true(session.accept(wire("1", "{}", ",\"terminal\":\"success\"")) is Ok(_))
  assert_true(session.register(wire("1", "{}", "")) is Err(_))
  assert_true(session.register(wire("2", "{}", "")) is Ok(_))
  assert_true(session.cancel(2.0) is Ok(true))
  assert_true(session.register(wire("2", "{}", "")) is Err(_))
  assert_true(session.accept(wire("2", "{}", ",\"terminal\":\"success\"")) is Err(_))
}

///|
test "What: bounded ledgers drain cancellation IDs exactly once on close" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  for id = 1; id <= MaxPending; id = id + 1 {
    assert_true(session.register(wire(id.to_string(), "{}", "")) is Ok(_))
  }
  assert_true(session.register(wire("257", "{}", "")) is Err(_))
  assert_eq(session.close().length(), MaxPending)
  assert_eq(session.close().length(), 0)
  assert_true(session.register(wire("258", "{}", "")) is Err(_))
}

///|
test "What: safe integer exhaustion and invalid session construction fail closed" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(wire("9007199254740991", "{}", "")) is Ok(_))
  assert_true(session.register(wire("9007199254740992", "{}", "")) is Err(_))
  assert_true(Session::new("invalid").status() is Err(_))
}


///|
test "What: native renderer-death events are correlated to the session and cannot replay" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  let event = "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":3,\"operation\":\"web-content-gone\",\"payload\":{}}"
  assert_true(session.observe(event) is Ok(_))
  assert_true(session.observe(event) is Err(_))
  let stale = "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":4,\"operation\":\"web-content-gone\",\"payload\":{}}"
  assert_true(session.observe(stale) is Err(_))
  let next = "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":2,\"window\":2,\"generation\":4,\"operation\":\"web-content-gone\",\"payload\":{}}"
  assert_true(session.observe(next) is Ok(_))
  assert_true(session.observe(wire("3", "{}", "")) is Err(_))
  assert_eq(session.close().length(), 0)
  assert_true(session.observe(next) is Err(_))
}


///|
test "What: native close events share the monotonic private notification ledger" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  let first = "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":4,\"generation\":0,\"operation\":\"native-close-request\",\"payload\":{}}"
  assert_true(session.observe(first) is Ok(_))
  assert_true(session.observe(first) is Err(_))
  let next = "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":2,\"window\":4,\"generation\":1,\"operation\":\"native-close-request\",\"payload\":{}}"
  assert_true(session.observe(next) is Ok(_))
  let unknown = "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":3,\"window\":4,\"generation\":1,\"operation\":\"cancel-close\",\"payload\":{}}"
  assert_true(session.observe(unknown) is Err(_))
}

///|
test "What: MoonBit gates native visibility commands and their correlation" {
  let prefix = "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":0,\"operation\":\""
  for operation in ["show-window", "hide-window", "is-window-visible"] {
    let raw = prefix + operation + "\",\"payload\":{}}"
    assert_true(validate(raw) is Ok(_))
    let session = Session::new("0123456789abcdef0123456789abcdef")
    assert_true(session.register(raw) is Ok(_))
    let completed = prefix + operation + "\",\"payload\":{\"visible\":true},\"terminal\":\"success\"}"
    assert_true(session.accept(completed) is Ok(_))
  }
  assert_true(validate(prefix + "toggle-visibility\",\"payload\":{}}") is Err(_))
}
