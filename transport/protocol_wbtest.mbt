///|
fn wire(id : String, payload : String, suffix : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":" + id + ",\"window\":2,\"generation\":3,\"operation\":\"show-window\",\"payload\":" + payload + suffix + "}"
}

///|
test "What: the MoonBit parser validates unchanged Unicode envelopes" {
  assert_true(validate(wire("1", "{\"text\":\"日本語😀\",\"items\":[true,null,1.5]}", "")) is Ok(_))
  assert_true(validate(wire("1", "{\"visible\":true}", ",\"terminal\":\"success\"")) is Ok(_))
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
  assert_true(session.accept(wire("1", "{\"visible\":true}", ",\"terminal\":\"success\"")) is Ok(_))
  assert_eq(session.pending_count(), 0)
}

///|
test "What: completion and cancellation never release an issued ID for reuse" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(wire("1", "{}", "")) is Ok(_))
  assert_true(session.accept(wire("1", "{\"visible\":true}", ",\"terminal\":\"success\"")) is Ok(_))
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
    let actual = if operation == "hide-window" { "false" } else { "true" }
    let completed = prefix + operation + "\",\"payload\":{\"visible\":" + actual + "},\"terminal\":\"success\"}"
    assert_true(session.accept(completed) is Ok(_))
  }
  assert_true(validate(prefix + "toggle-visibility\",\"payload\":{}}") is Err(_))
}

///|
fn visibility_wire(operation : String, payload : String, terminal : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":0,\"operation\":\"" + operation + "\",\"payload\":" + payload + terminal + "}"
}

///|
test "What: invalid visibility successes never consume pending work" {
  for operation in ["show-window", "hide-window", "is-window-visible"] {
    let session = Session::new("0123456789abcdef0123456789abcdef")
    assert_true(session.register(visibility_wire(operation, "{}", "")) is Ok(_))
    for invalid in [
      "{}", "{\"visible\":null}", "{\"visible\":\"true\"}", "{\"visible\":1}",
      "{\"visible\":[]}", "{\"visible\":true,\"extra\":1}",
    ] {
      let bad = visibility_wire(operation, invalid, ",\"terminal\":\"success\"")
      assert_true(validate(bad) is Err(_))
      assert_true(session.accept(bad) is Err(_))
      assert_eq(session.pending_count(), 1)
    }
    if operation != "is-window-visible" {
      let reversed = if operation == "show-window" { "false" } else { "true" }
      let bad = visibility_wire(operation, "{\"visible\":" + reversed + "}", ",\"terminal\":\"success\"")
      assert_true(validate(bad) is Err(_))
      assert_true(session.accept(bad) is Err(_))
      assert_eq(session.pending_count(), 1)
    }
    let expected = if operation == "hide-window" { "false" } else { "true" }
    let good = visibility_wire(operation, "{\"visible\":" + expected + "}", ",\"terminal\":\"success\"")
    assert_true(validate(good) is Ok(_))
    assert_true(session.accept(good) is Ok(_))
    assert_eq(session.pending_count(), 0)
    assert_true(session.accept(good) is Err(_))
  }
  assert_true(validate(visibility_wire("is-window-visible", "{\"visible\":false}", ",\"terminal\":\"success\"")) is Ok(_))
}

///|
test "What: failed visibility terminals are not success ACKs" {
  for terminal in ["failure", "cancelled"] {
    let session = Session::new("0123456789abcdef0123456789abcdef")
    assert_true(session.register(visibility_wire("show-window", "{}", "")) is Ok(_))
    let reply = visibility_wire("show-window", "{\"code\":\"ELECTRON_MBT_STALE_DOCUMENT\"}",
      ",\"terminal\":\"" + terminal + "\"")
    assert_true(validate(reply) is Ok(_))
    assert_true(session.accept(reply) is Ok(_))
    assert_eq(session.pending_count(), 0)
  }
}

///|
test "What: native window titles require bounded values and matching success ACKs" {
  let initial = visibility_wire("get-window-title", "{}", "")
  let gate = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(gate.register(initial) is Ok(_))
  assert_true(gate.accept(visibility_wire("get-window-title", "{\"title\":false}", ",\"terminal\":\"success\"")) is Err(_))
  assert_eq(gate.pending_count(), 1)
  assert_true(gate.accept(visibility_wire("get-window-title", "{\"title\":\"日本語\"}", ",\"terminal\":\"success\"")) is Ok(_))
  assert_eq(gate.pending_count(), 0)

  let set_request = visibility_wire("set-window-title", "{\"title\":\"New title\"}", "")
  let pending = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(pending.register(set_request) is Ok(_))
  let wrong = visibility_wire("set-window-title", "{\"title\":\"Other\"}", ",\"terminal\":\"success\"")
  assert_true(pending.accept(wrong) is Err(_))
  assert_eq(pending.pending_count(), 1)
  let good = visibility_wire("set-window-title", "{\"title\":\"New title\"}", ",\"terminal\":\"success\"")
  assert_true(pending.accept(good) is Ok(_))
  assert_eq(pending.pending_count(), 0)
  assert_true(pending.accept(good) is Err(_))

  assert_true(validate(visibility_wire("get-window-title", "{\"title\":\"injected\"}", "")) is Err(_))
  assert_true(validate(visibility_wire("set-window-title", "{}", "")) is Err(_))
  assert_true(validate(visibility_wire("set-window-title", "{\"title\":5}", "")) is Err(_))
  assert_true(validate(visibility_wire("get-window-title", "{\"extra\":1}", ",\"terminal\":\"success\"")) is Err(_))
  let mut title = ""
  for i = 0; i < 257; i = i + 1 { title = title + "x" }
  assert_true(validate(visibility_wire("set-window-title", "{\"title\":\"" + title + "\"}", "")) is Err(_))
  let failed = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(failed.register(set_request) is Ok(_))
  assert_true(failed.accept(visibility_wire("set-window-title", "{\"code\":\"ELECTRON_MBT_WINDOW_OPTIONS\"}", ",\"terminal\":\"failure\"")) is Ok(_))
}

///|
test "What: native web contents URL requires an empty request and bounded one-field success" {
  let request = visibility_wire("get-web-contents-url", "{}", "")
  let gate = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(gate.register(request) is Ok(_))
  for invalid in [
    "{}", "{\"url\":null}", "{\"url\":7}", "{\"url\":[]}",
    "{\"url\":\"file:///index.html\",\"extra\":true}",
  ] {
    let reply = visibility_wire("get-web-contents-url", invalid, ",\"terminal\":\"success\"")
    assert_true(validate(reply) is Err(_))
    assert_true(gate.accept(reply) is Err(_))
    assert_eq(gate.pending_count(), 1)
  }
  let good = visibility_wire("get-web-contents-url", "{\"url\":\"file:///app/index.html\"}", ",\"terminal\":\"success\"")
  assert_true(gate.accept(good) is Ok(_))
  assert_eq(gate.pending_count(), 0)
  assert_true(gate.accept(good) is Err(_))
  assert_true(validate(visibility_wire("get-web-contents-url", "{\"injected\":true}", "")) is Err(_))
  let mut long_url = ""
  for i = 0; i < 8193; i = i + 1 { long_url = long_url + "x" }
  assert_true(validate(visibility_wire("get-web-contents-url", "{\"url\":\"" + long_url + "\"}", ",\"terminal\":\"success\"")) is Err(_))
  let empty = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(empty.register(request) is Ok(_))
  assert_true(empty.accept(visibility_wire("get-web-contents-url", "{\"url\":\"\"}", ",\"terminal\":\"success\"")) is Ok(_))
}

///|
test "What: web contents title requests and success ACKs are shape and length checked" {
  let request = visibility_wire("get-web-contents-title", "{}", "")
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(request) is Ok(_))
  for bad_payload in [
    "{}", "{\"title\":null}", "{\"title\":99}",
    "{\"title\":\"M1\",\"extra\":true}",
  ] {
    let bad = visibility_wire("get-web-contents-title", bad_payload, ",\"terminal\":\"success\"")
    assert_true(validate(bad) is Err(_))
    assert_true(session.accept(bad) is Err(_))
    assert_eq(session.pending_count(), 1)
  }
  assert_true(validate(visibility_wire("get-web-contents-title", "{\"extra\":true}", "")) is Err(_))
  let mut long_title = ""
  for i = 0; i < 4097; i = i + 1 { long_title = long_title + "x" }
  let excessive = visibility_wire("get-web-contents-title", "{\"title\":\"" + long_title + "\"}", ",\"terminal\":\"success\"")
  assert_true(validate(excessive) is Err(_))
  assert_true(session.accept(excessive) is Err(_))
  assert_eq(session.pending_count(), 1)
  let valid = visibility_wire("get-web-contents-title", "{\"title\":\"日本語 😀\"}", ",\"terminal\":\"success\"")
  assert_true(session.accept(valid) is Ok(_))
  assert_eq(session.pending_count(), 0)
  assert_true(session.accept(valid) is Err(_))
  let empty = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(empty.register(request) is Ok(_))
  assert_true(empty.accept(visibility_wire("get-web-contents-title", "{\"title\":\"\"}", ",\"terminal\":\"success\"")) is Ok(_))
}

///|
test "What: get-window-bounds has empty requests and exact integer native ACKs" {
  let request = visibility_wire("get-window-bounds", "{}", "")
  let gate = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(gate.register(request) is Ok(_))
  let invalid = [
    "{}", "{\"x\":0,\"y\":1,\"width\":640}",
    "{\"x\":0,\"y\":1,\"width\":640,\"height\":480,\"extra\":1}",
    "{\"x\":0,\"y\":1,\"width\":640.5,\"height\":480}",
    "{\"x\":0,\"y\":1,\"width\":0,\"height\":480}",
    "{\"x\":0,\"y\":1,\"width\":640,\"height\":-1}",
    "{\"x\":0,\"y\":true,\"width\":640,\"height\":480}",
    "{\"x\":1048577,\"y\":1,\"width\":640,\"height\":480}",
  ]
  for bad in invalid {
    let response = visibility_wire("get-window-bounds", bad, ",\"terminal\":\"success\"")
    assert_true(validate(response) is Err(_))
    assert_true(gate.accept(response) is Err(_))
    assert_eq(gate.pending_count(), 1)
  }
  assert_true(validate(visibility_wire("get-window-bounds", "{\"x\":0}", "")) is Err(_))
  let valid = visibility_wire("get-window-bounds", "{\"x\":-20,\"y\":50,\"width\":640,\"height\":504}", ",\"terminal\":\"success\"")
  assert_true(gate.accept(valid) is Ok(_))
  assert_eq(gate.pending_count(), 0)
  assert_true(gate.accept(valid) is Err(_))
  let failed = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(failed.register(request) is Ok(_))
  assert_true(failed.accept(visibility_wire("get-window-bounds", "{\"code\":\"ELECTRON_MBT_STALE_DOCUMENT\"}", ",\"terminal\":\"failure\"")) is Ok(_))
}

///|
test "What: set-window-bounds validates safe partial geometry and native success ACK" {
  let prefix = visibility_wire("set-window-bounds", "{}", "")
  assert_true(validate(prefix) is Ok(_))
  assert_true(validate(visibility_wire("set-window-bounds", "{\"width\":640}", "")) is Ok(_))
  assert_true(validate(visibility_wire("set-window-bounds", "{\"x\":-30,\"y\":45,\"width\":720,\"height\":540}", "")) is Ok(_))
  for bad in [
    "{\"extra\":20}", "{\"width\":99}", "{\"height\":4097}",
    "{\"x\":1048577}", "{\"y\":-1048577}", "{\"width\":640.5}",
    "{\"height\":true}", "{\"x\":null}", "{\"x\":-0}",
    "{\"width\":640,\"height\":480,\"x\":0,\"y\":0,\"extra\":1}",
  ] {
    assert_true(validate(visibility_wire("set-window-bounds", bad, "")) is Err(_))
  }
  let gate = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(gate.register(visibility_wire("set-window-bounds", "{\"width\":700}", "")) is Ok(_))
  for bad in [
    "{}", "{\"x\":1,\"y\":2,\"width\":700}",
    "{\"x\":1,\"y\":2,\"width\":700,\"height\":500,\"extra\":true}",
    "{\"x\":1,\"y\":2,\"width\":700.5,\"height\":500}",
  ] {
    let response = visibility_wire("set-window-bounds", bad, ",\"terminal\":\"success\"")
    assert_true(gate.accept(response) is Err(_))
    assert_eq(gate.pending_count(), 1)
  }
  let valid = visibility_wire("set-window-bounds", "{\"x\":1,\"y\":2,\"width\":700,\"height\":500}", ",\"terminal\":\"success\"")
  assert_true(gate.accept(valid) is Ok(_))
  assert_eq(gate.pending_count(), 0)
  assert_true(gate.accept(valid) is Err(_))
  let failure = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(failure.register(prefix) is Ok(_))
  assert_true(failure.accept(visibility_wire("set-window-bounds", "{\"code\":\"ELECTRON_MBT_WINDOW_UNKNOWN\"}", ",\"terminal\":\"failure\"")) is Ok(_))
}
