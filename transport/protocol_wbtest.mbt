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


///|
test "What: rounded fractional bounds tokens cannot complete pending native geometry" {
  let request = visibility_wire("get-window-bounds", "{}", "")
  let gate = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(gate.register(request) is Ok(_))
  for payload in [
    "{\"x\":1.00000000000000001,\"y\":2,\"width\":640,\"height\":480}",
    "{\"x\":-1.00000000000000001,\"y\":2,\"width\":640,\"height\":480}",
    "{\"x\":0.99999999999999999,\"y\":2,\"width\":640,\"height\":480}",
    "{\"x\":1,\"y\":2.00000000000000001,\"width\":640,\"height\":480}",
    "{\"x\":1,\"y\":2,\"width\":639.99999999999999999,\"height\":480}",
    "{\"x\":1,\"y\":2,\"width\":640,\"height\":4.80000000000000000001e2}",
  ] {
    let invalid = visibility_wire("get-window-bounds", payload, ",\"terminal\":\"success\"")
    assert_true(validate(invalid) is Err(_))
    assert_true(gate.accept(invalid) is Err(_))
    assert_eq(gate.pending_count(), 1)
  }
  let valid = visibility_wire("get-window-bounds",
    "{\"x\":-2.0e1,\"y\":5e1,\"width\":6.4e2,\"height\":4.8e2}",
    ",\"terminal\":\"success\"")
  assert_true(gate.accept(valid) is Ok(_))
  assert_eq(gate.pending_count(), 0)
}

///|
test "What: rounded fractional setBounds requests are invalid before registration" {
  for payload in [
    "{\"x\":1.00000000000000001}",
    "{\"x\":-1.00000000000000001}",
    "{\"y\":-0.99999999999999999}",
    "{\"width\":639.99999999999999999}",
    "{\"height\":4.80000000000000000001e2}",
  ] {
    let invalid = visibility_wire("set-window-bounds", payload, "")
    assert_true(validate(invalid) is Err(_))
    let pending = Session::new("0123456789abcdef0123456789abcdef")
    assert_true(pending.register(invalid) is Err(_))
    assert_eq(pending.pending_count(), 0)
  }
  assert_true(validate(visibility_wire("set-window-bounds",
    "{\"x\":-2.0e1,\"y\":5e1,\"width\":6.4e2,\"height\":4.8e2}", "")) is Ok(_))
}


///|
fn bootstrap_wire(generation : String, payload : String, suffix : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":" +
    generation + ",\"operation\":\"get-bootstrap-status\",\"payload\":" + payload + suffix + "}"
}

///|
test "What: native isolated bootstrap status cannot forge a frame or document generation" {
  let request = bootstrap_wire("3", "{}", "")
  assert_true(validate(request) is Ok(_))
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(request) is Ok(_))
  let completed = bootstrap_wire("3", "{\"observed\":true,\"mainFrame\":true,\"generation\":3,\"documentURL\":\"file:///app/bootstrap.html\"}", ",\"terminal\":\"success\"")
  assert_true(session.accept(completed) is Ok(_))
  for malformed in [
    "{\"observed\":true,\"mainFrame\":false,\"generation\":3,\"documentURL\":\"file:///app/bootstrap.html\"}",
    "{\"observed\":true,\"mainFrame\":true,\"generation\":2,\"documentURL\":\"file:///app/bootstrap.html\"}",
    "{\"observed\":true,\"mainFrame\":true,\"generation\":3,\"documentURL\":\"\"}",
    "{\"observed\":false,\"mainFrame\":false,\"generation\":3,\"documentURL\":\"file:///app/bootstrap.html\"}",
    "{\"observed\":\"true\",\"mainFrame\":true,\"generation\":3,\"documentURL\":\"file:///app/bootstrap.html\"}",
    "{\"observed\":true,\"mainFrame\":true,\"generation\":\"3\",\"documentURL\":\"file:///app/bootstrap.html\"}",
    "{\"observed\":true,\"mainFrame\":true,\"generation\":3,\"documentURL\":\"file:///app/bootstrap.html\",\"nonce\":\"do-not-serialize\"}",
  ] {
    assert_true(validate(bootstrap_wire("3", malformed, ",\"terminal\":\"success\"")) is Err(_))
  }
  assert_true(validate(bootstrap_wire("3", "{\"unexpected\":true}", "")) is Err(_))
  let not_ready = bootstrap_wire("0", "{\"observed\":false,\"mainFrame\":false,\"generation\":0,\"documentURL\":\"\"}", ",\"terminal\":\"success\"")
  assert_true(validate(not_ready) is Ok(_))
}

///|
test "What: native isolated attestation is one-shot, bounded and cannot be registered as control work" {
  let secret = "0123456789abcdef0123456789abcdef"
  let session = Session::new(secret)
  let first = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":1,\"window\":2,\"generation\":1,\"operation\":\"isolated-preload-attested\",\"payload\":{}}"
  assert_true(validate(first) is Ok(_))
  assert_true(session.register(first) is Err(_))
  assert_true(session.observe(first) is Ok(_))
  assert_true(session.observe(first) is Err(_))
  let wrong_payload = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":2,\"operation\":\"isolated-preload-attested\",\"payload\":{\"channel\":\"all\"}}"
  assert_true(validate(wrong_payload) is Err(_))
  assert_true(session.observe(wrong_payload) is Err(_))
  let bad_generation = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":0,\"operation\":\"isolated-preload-attested\",\"payload\":{}}"
  assert_true(validate(bad_generation) is Err(_))
  let second = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":2,\"operation\":\"isolated-preload-attested\",\"payload\":{}}"
  assert_true(session.observe(second) is Ok(_))
  let success = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":3,\"window\":2,\"generation\":2,\"operation\":\"isolated-preload-attested\",\"payload\":{},\"terminal\":\"success\"}"
  assert_true(session.observe(success) is Err(_))
}

///|
test "What: preload exposure events require exact bounded metadata and cannot be registered" {
  let secret = "0123456789abcdef0123456789abcdef"
  let session = Session::new(secret)
  let digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let valid = "{\"version\":1,\"session\":\"" + secret +
    "\",\"request\":1,\"window\":2,\"generation\":1,\"operation\":\"preload-exposure\",\"payload\":{\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":10,\"descriptorSHA256\":\"" +
    digest + "\"}}"
  assert_true(validate(valid) is Ok(_))
  assert_true(session.register(valid) is Err(_))
  assert_true(session.observe(valid) is Ok(_))
  assert_true(session.observe(valid) is Err(_))
  let malformed = [
    "{\"version\":1,\"session\":\"" + secret +
      "\",\"request\":2,\"window\":2,\"generation\":1,\"operation\":\"preload-exposure\",\"payload\":{\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":10}}",
    "{\"version\":1,\"session\":\"" + secret +
      "\",\"request\":2,\"window\":2,\"generation\":1,\"operation\":\"preload-exposure\",\"payload\":{\"apiKey\":\"fixture\",\"descriptorBytes\":0,\"functionCount\":10,\"descriptorSHA256\":\"" + digest + "\"}}",
    "{\"version\":1,\"session\":\"" + secret +
      "\",\"request\":2,\"window\":2,\"generation\":1,\"operation\":\"preload-exposure\",\"payload\":{\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":257,\"descriptorSHA256\":\"" + digest + "\"}}",
    "{\"version\":1,\"session\":\"" + secret +
      "\",\"request\":2,\"window\":2,\"generation\":1,\"operation\":\"preload-exposure\",\"payload\":{\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":10,\"descriptorSHA256\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"}}",
    "{\"version\":1,\"session\":\"" + secret +
      "\",\"request\":2,\"window\":2,\"generation\":0,\"operation\":\"preload-exposure\",\"payload\":{\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":10,\"descriptorSHA256\":\"" + digest + "\"}}",
  ]
  for raw in malformed { assert_true(validate(raw) is Err(_)) }
}

///|
test "What: min-size and background operations validate exact payloads" {
  assert_true(validate(visibility_wire("get-window-min-size", "{}", "")) is Ok(_))
  assert_true(validate(visibility_wire("get-window-min-size", "{\"width\":320,\"height\":240}", ",\"terminal\":\"success\"")) is Ok(_))
  assert_true(validate(visibility_wire("set-window-min-size", "{\"width\":320,\"height\":240}", "")) is Ok(_))
  for bad in ["{}", "{\"width\":320}", "{\"width\":-1,\"height\":240}", "{\"width\":320.5,\"height\":240}", "{\"width\":5000,\"height\":240}"] {
    assert_true(validate(visibility_wire("set-window-min-size", bad, "")) is Err(_))
  }
  assert_true(validate(visibility_wire("get-window-background-color", "{}", "")) is Ok(_))
  assert_true(validate(visibility_wire("get-window-background-color", "{\"color\":\"#112233\"}", ",\"terminal\":\"success\"")) is Ok(_))
  assert_true(validate(visibility_wire("set-window-background-color", "{\"color\":\"#112233\"}", "")) is Ok(_))
  for bad in ["{}", "{\"color\":\"#123\"}", "{\"color\":\"#gggggg\"}", "{\"color\":5}"] {
    assert_true(validate(visibility_wire("set-window-background-color", bad, "")) is Err(_))
  }
}

///|
test "What: preload-status operation validates empty requests and bounded ACKs" {
  assert_true(validate(visibility_wire("get-preload-status", "{}", "")) is Ok(_))
  assert_true(validate(visibility_wire("get-preload-status",
    "{\"status\":\"unsupported\",\"detail\":\"contextBridge.exposeInMainWorld\"}",
    ",\"terminal\":\"success\"")) is Ok(_))
  for bad in ["{\"status\":\"bogus\",\"detail\":\"\"}", "{\"status\":\"ok\"}",
    "{\"status\":\"ok\",\"detail\":5}", "{\"status\":\"ok\",\"detail\":\"" + "x".repeat(129) + "\"}"] {
    assert_true(validate(visibility_wire("get-preload-status", bad,
      ",\"terminal\":\"success\"")) is Err(_))
  }
  assert_true(validate(visibility_wire("get-preload-status", "{\"x\":1}", "")) is Err(_))
}

///|
test "What: adapted-adapter installation validates path and acknowledgement" {
  assert_true(validate(visibility_wire("install-adapted-adapter",
    "{\"file\":\"adapted/page-api.js\"}", "")) is Ok(_))
  assert_true(validate(visibility_wire("install-adapted-adapter",
    "{\"installed\":true}", ",\"terminal\":\"success\"")) is Ok(_))
  for bad in ["{}", "{\"file\":\"\"}", "{\"file\":5}", "{\"file\":\"" + "x".repeat(8193) + "\"}"] {
    assert_true(validate(visibility_wire("install-adapted-adapter", bad, "")) is Err(_))
  }
  assert_true(validate(visibility_wire("install-adapted-adapter",
    "{\"installed\":false}", ",\"terminal\":\"success\"")) is Err(_))
}

///|
fn adapted_status_wire(payload : String, suffix : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":1,\"operation\":\"get-adapted-status\",\"payload\":" +
    payload + suffix + "}"
}

///|
test "What: adapted installation status is bound to the current document and LoadComplete" {
  assert_true(validate(adapted_status_wire("{}", "")) is Ok(_))
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(adapted_status_wire("{}", "")) is Ok(_))
  let completed = adapted_status_wire(
    "{\"observed\":true,\"generation\":1,\"documentStartBeforeLoad\":true,\"ingress\":\"absent\"}",
    ",\"terminal\":\"success\"",
  )
  assert_true(session.accept(completed) is Ok(_))
  for malformed in [
    "{\"observed\":true,\"generation\":2,\"documentStartBeforeLoad\":true,\"ingress\":\"absent\"}",
    "{\"observed\":true,\"generation\":1,\"documentStartBeforeLoad\":false,\"ingress\":\"absent\"}",
    "{\"observed\":false,\"generation\":1,\"documentStartBeforeLoad\":false,\"ingress\":\"native\"}",
    "{\"observed\":true,\"generation\":1,\"documentStartBeforeLoad\":true}",
    "{\"observed\":\"true\",\"generation\":1,\"documentStartBeforeLoad\":true,\"ingress\":\"absent\"}",
  ] {
    assert_true(validate(adapted_status_wire(malformed, ",\"terminal\":\"success\"")) is Err(_))
  }
  assert_true(validate(adapted_status_wire("{\"x\":1}", "")) is Err(_))
}

///|
fn adapted_event_wire(payload : String, suffix : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":1,\"operation\":\"dispatch-adapted-event\",\"payload\":" +
    payload + suffix + "}"
}

///|
test "What: adapted event delivery is fixed-topic and generation-bound" {
  assert_true(validate(adapted_event_wire("{\"topic\":\"doc:open\",\"value\":\"native\"}", "")) is Ok(_))
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(adapted_event_wire("{\"topic\":\"doc:open\",\"value\":\"native\"}", "")) is Ok(_))
  let completed = adapted_event_wire(
    "{\"delivered\":true,\"topic\":\"doc:open\",\"generation\":1}",
    ",\"terminal\":\"success\"",
  )
  assert_true(session.accept(completed) is Ok(_))
  for malformed in [
    "{}",
    "{\"topic\":\"unknown\",\"value\":\"x\"}",
    "{\"topic\":\"doc:open\",\"value\":\"\"}",
    "{\"topic\":\"doc:open\",\"value\":123}",
    "{\"topic\":\"doc:open\",\"value\":\"x\",\"extra\":1}",
  ] {
    assert_true(validate(adapted_event_wire(malformed, "")) is Err(_))
  }
  for malformed in [
    "{\"delivered\":false,\"topic\":\"doc:open\",\"generation\":1}",
    "{\"delivered\":true,\"topic\":\"doc:open\",\"generation\":2}",
    "{\"delivered\":true,\"topic\":\"unknown\",\"generation\":1}",
    "{\"delivered\":true,\"topic\":\"doc:open\"}",
  ] {
    assert_true(validate(adapted_event_wire(malformed, ",\"terminal\":\"success\"")) is Err(_))
  }
}

///|
fn source_wire(operation : String, payload : String, suffix : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":1,\"operation\":\"" +
    operation + "\",\"payload\":" + payload + suffix + "}"
}

///|
test "What: source snapshot preparation validates the manifest shape" {
  let hash = "a".repeat(64)
  let manifest = "c".repeat(64)
  let request = source_wire("prepare-source", "{\"file\":\"index.html\"}", "")
  assert_true(validate(request) is Ok(_))
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(request) is Ok(_))
  let completed = source_wire("prepare-source",
    "{\"prepared\":true,\"sha256\":\"" + hash + "\",\"bytes\":2246,\"files\":2,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    ",\"terminal\":\"success\"")
  assert_true(session.accept(completed) is Ok(_))
  for malformed in [
    "{}",
    "{\"file\":\"\"}",
    "{\"file\":\"../escape\"}",
    "{\"file\":\"/absolute\"}",
    "{\"file\":\"index.html\",\"extra\":1}",
  ] {
    assert_true(validate(source_wire("prepare-source", malformed, "")) is Err(_))
  }
  for malformed in [
    "{\"prepared\":false,\"sha256\":\"" + hash + "\",\"bytes\":2246,\"files\":2,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"prepared\":true,\"sha256\":\"short\",\"bytes\":2246,\"files\":2,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"prepared\":true,\"sha256\":\"" + hash + "\",\"bytes\":0,\"files\":2,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"prepared\":true,\"sha256\":\"" + hash + "\",\"bytes\":16777217,\"files\":2,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"prepared\":true,\"sha256\":\"" + hash + "\",\"bytes\":2246,\"files\":0,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"prepared\":true,\"sha256\":\"" + hash + "\",\"bytes\":2246,\"files\":4097,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"prepared\":true,\"sha256\":\"" + hash + "\",\"bytes\":2246,\"files\":2,\"manifestSHA256\":\"short\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"prepared\":true,\"sha256\":\"" + hash + "\",\"bytes\":2246,\"files\":2,\"manifestSHA256\":\"" + manifest + "\",\"root\":\"\"}",
  ] {
    assert_true(validate(source_wire("prepare-source", malformed, ",\"terminal\":\"success\"")) is Err(_))
  }
}

///|
test "What: dialog results accept only open/save with a bounded path" {
  assert_true(validate(source_wire("set-dialog-result",
    "{\"kind\":\"open\",\"path\":\"samples/sample.md\"}", "")) is Ok(_))
  assert_true(validate(source_wire("set-dialog-result",
    "{\"kind\":\"export-png\",\"path\":\"broker-export.png\"}", "")) is Ok(_))
  assert_true(validate(source_wire("set-dialog-result",
    "{\"kind\":\"export-pdf\",\"path\":\"broker-export.pdf\"}", "")) is Ok(_))
  assert_true(validate(source_wire("set-dialog-result",
    "{\"kind\":\"export-doc-png\",\"path\":\"broker-export-doc.png\"}", "")) is Ok(_))
  for malformed in [
    "{}",
    "{\"kind\":\"open\"}",
    "{\"kind\":\"other\",\"path\":\"samples/sample.md\"}",
    "{\"kind\":\"open\",\"path\":\"\"}",
    "{\"kind\":\"open\",\"path\":\"x\",\"extra\":1}",
  ] {
    assert_true(validate(source_wire("set-dialog-result", malformed, "")) is Err(_))
  }
  assert_true(validate(source_wire("set-dialog-result",
    "{\"set\":true,\"kind\":\"save\",\"path\":\"/tmp/x\"}",
    ",\"terminal\":\"success\"")) is Ok(_))
  assert_true(validate(source_wire("set-dialog-result",
    "{\"set\":false,\"kind\":\"save\",\"path\":\"/tmp/x\"}",
    ",\"terminal\":\"success\"")) is Err(_))
}

///|
test "What: file grants accept only a bounded path and read/write mode" {
  let request = source_wire("grant-file",
    "{\"path\":\"broker-output.txt\",\"mode\":\"readwrite\"}", "")
  assert_true(validate(request) is Ok(_))
  for malformed in [
    "{}",
    "{\"path\":\"x\"}",
    "{\"path\":\"\",\"mode\":\"read\"}",
    "{\"path\":\"x\",\"mode\":\"execute\"}",
    "{\"path\":\"x\",\"mode\":\"read\",\"extra\":1}",
  ] {
    assert_true(validate(source_wire("grant-file", malformed, "")) is Err(_))
  }
  assert_true(validate(source_wire("grant-file",
    "{\"granted\":true,\"path\":\"/tmp/x\",\"mode\":\"readwrite\"}",
    ",\"terminal\":\"success\"")) is Ok(_))
  assert_true(validate(source_wire("grant-file",
    "{\"granted\":false,\"path\":\"/tmp/x\",\"mode\":\"readwrite\"}",
    ",\"terminal\":\"success\"")) is Err(_))
}

///|
test "What: document identity binds the snapshot and manifest hashes to the current generation" {
  let hash = "b".repeat(64)
  let manifest = "d".repeat(64)
  let request = source_wire("get-document-identity", "{}", "")
  assert_true(validate(request) is Ok(_))
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(request) is Ok(_))
  let completed = source_wire("get-document-identity",
    "{\"generation\":1,\"source\":\"snapshot\",\"sha256\":\"" + hash + "\",\"manifestSHA256\":\"" + manifest + "\"}",
    ",\"terminal\":\"success\"")
  assert_true(session.accept(completed) is Ok(_))
  assert_true(validate(source_wire("get-document-identity",
    "{\"generation\":1,\"source\":\"app\",\"sha256\":\"\",\"manifestSHA256\":\"\"}",
    ",\"terminal\":\"success\"")) is Ok(_))
  for malformed in [
    "{\"generation\":2,\"source\":\"snapshot\",\"sha256\":\"" + hash + "\",\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"generation\":1,\"source\":\"other\",\"sha256\":\"" + hash + "\",\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"generation\":1,\"source\":\"snapshot\",\"sha256\":\"\",\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"generation\":1,\"source\":\"snapshot\",\"sha256\":\"" + hash + "\",\"manifestSHA256\":\"\"}",
    "{\"generation\":1,\"source\":\"app\",\"sha256\":\"" + hash + "\",\"manifestSHA256\":\"\"}",
    "{\"generation\":1,\"source\":\"app\",\"sha256\":\"\",\"manifestSHA256\":\"" + manifest + "\",\"root\":\"/tmp/electron-mbt-snapshot-test\"}",
    "{\"generation\":1,\"source\":\"snapshot\",\"sha256\":\"" + hash + "\"}",
  ] {
    assert_true(validate(source_wire("get-document-identity", malformed, ",\"terminal\":\"success\"")) is Err(_))
  }
  assert_true(validate(source_wire("get-document-identity", "{\"x\":1}", "")) is Err(_))
}

///|
fn ingress_wire(operation : String, payload : String, suffix : String) -> String {
  "{\"version\":1,\"session\":\"0123456789abcdef0123456789abcdef\",\"request\":1,\"window\":2,\"generation\":1,\"operation\":\"" +
    operation + "\",\"payload\":" + payload + suffix + "}"
}

///|
test "What: native ingress status, release and trigger envelopes are bounded" {
  assert_true(validate(ingress_wire("get-ingress-status", "{}", "")) is Ok(_))
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(ingress_wire("get-ingress-status", "{}", "")) is Ok(_))
  let completed = ingress_wire("get-ingress-status",
    "{\"admitted\":1,\"denied\":2,\"unhandled\":4,\"lastCode\":\"ELECTRON_MBT_NO_HANDLER\",\"generation\":1}",
    ",\"terminal\":\"success\"")
  assert_true(session.accept(completed) is Ok(_))
  for malformed in [
    "{\"admitted\":-1,\"denied\":2,\"unhandled\":4,\"lastCode\":\"x\",\"generation\":1}",
    "{\"admitted\":1,\"denied\":-1,\"unhandled\":4,\"lastCode\":\"x\",\"generation\":1}",
    "{\"admitted\":1,\"denied\":2,\"unhandled\":-1,\"lastCode\":\"x\",\"generation\":1}",
    "{\"admitted\":1,\"denied\":2,\"unhandled\":4,\"lastCode\":\"" + "x".repeat(129) + "\",\"generation\":1}",
    "{\"admitted\":1,\"denied\":2,\"unhandled\":4,\"lastCode\":\"x\",\"generation\":2}",
    "{\"admitted\":1,\"denied\":2,\"unhandled\":4,\"lastCode\":\"x\",\"generation\":1,\"extra\":1}",
  ] {
    assert_true(validate(ingress_wire("get-ingress-status", malformed, ",\"terminal\":\"success\"")) is Err(_))
  }
  assert_true(validate(ingress_wire("get-ingress-status", "{\"x\":1}", "")) is Err(_))

  assert_true(validate(ingress_wire("release-adapted-ingress", "{}", "")) is Ok(_))
  assert_true(validate(ingress_wire("release-adapted-ingress",
    "{\"released\":true}", ",\"terminal\":\"success\"")) is Ok(_))
  for malformed in ["{\"released\":false}", "{}", "{\"released\":true,\"extra\":1}"] {
    assert_true(validate(ingress_wire("release-adapted-ingress", malformed, ",\"terminal\":\"success\"")) is Err(_))
  }

  assert_true(validate(ingress_wire("trigger-adapted-ingress", "{}", "")) is Ok(_))
  assert_true(validate(ingress_wire("trigger-adapted-ingress",
    "{\"triggered\":true}", ",\"terminal\":\"success\"")) is Ok(_))
  for malformed in ["{\"triggered\":false}", "{}", "{\"triggered\":true,\"extra\":1}"] {
    assert_true(validate(ingress_wire("trigger-adapted-ingress", malformed, ",\"terminal\":\"success\"")) is Err(_))
  }
}

///|
test "What: preload bridge install/report shapes are exact and native reports cannot be registered" {
  let secret = "0123456789abcdef0123456789abcdef"
  let digest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let request = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":1,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"codecSource\":\"c\",\"pageShimSource\":\"p\",\"isolatedSource\":\"i\",\"apiKey\":\"fixture\",\"exposure\":{\"apiKey\":\"fixture\",\"descriptorBytes\":1,\"functionCount\":0,\"descriptorSHA256\":\"" + digest + "\"},\"codecSHA256\":\"" + digest + "\",\"pageShimSHA256\":\"" + digest + "\",\"isolatedSHA256\":\"" + digest + "\"}}"
  let session = Session::new(secret)
  assert_true(validate(request) is Ok(_))
  assert_true(session.register(request) is Ok(_))
  let acknowledgement = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":1,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"installed\":true},\"terminal\":\"success\"}"
  assert_true(validate(acknowledgement) is Ok(_))
  let malformed = [
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"codecSource\":\"c\",\"pageShimSource\":\"p\",\"isolatedSource\":\"i\",\"codecSHA256\":\"" + digest + "\",\"pageShimSHA256\":\"" + digest + "\"}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"codecSource\":\"c\",\"pageShimSource\":\"p\",\"isolatedSource\":\"i\",\"codecSHA256\":\"" + digest + "\",\"pageShimSHA256\":\"" + digest + "\",\"isolatedSHA256\":\"" + digest + "\",\"extra\":true}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"codecSource\":\"c\",\"pageShimSource\":\"p\",\"isolatedSource\":\"i\",\"codecSHA256\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\",\"pageShimSHA256\":\"" + digest + "\",\"isolatedSHA256\":\"" + digest + "\"}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"codecSource\":\"\",\"pageShimSource\":\"p\",\"isolatedSource\":\"i\",\"codecSHA256\":\"" + digest + "\",\"pageShimSHA256\":\"" + digest + "\",\"isolatedSHA256\":\"" + digest + "\"}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"codecSource\":\"c\",\"pageShimSource\":\"p\",\"isolatedSource\":\"i\",\"apiKey\":\"\",\"codecSHA256\":\"" + digest + "\",\"pageShimSHA256\":\"" + digest + "\",\"isolatedSHA256\":\"" + digest + "\"}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"install-preload-bridge\",\"payload\":{\"codecSource\":\"c\",\"pageShimSource\":\"p\",\"isolatedSource\":\"i\",\"apiKey\":\"fixture\",\"exposure\":{\"apiKey\":\"other\",\"descriptorBytes\":1,\"functionCount\":0,\"descriptorSHA256\":\"" + digest + "\"},\"codecSHA256\":\"" + digest + "\",\"pageShimSHA256\":\"" + digest + "\",\"isolatedSHA256\":\"" + digest + "\"}}",
  ]
  for raw in malformed { assert_true(validate(raw) is Err(_)) }

  let report = "{\"version\":1,\"session\":\"" + secret + "\",\"request\":3,\"window\":2,\"generation\":3,\"operation\":\"preload-report\",\"payload\":{\"channel\":\"fixture:report\",\"value\":{\"syncValue\":42}}}"
  let eventSession = Session::new(secret)
  assert_true(validate(report) is Ok(_))
  assert_true(eventSession.register(report) is Err(_))
  assert_true(eventSession.observe(report) is Ok(_))
  assert_true(eventSession.observe(report) is Err(_))
  for raw in [
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"preload-report\",\"payload\":{\"channel\":\"fixture:report\"}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"preload-report\",\"payload\":{\"channel\":\"fixture:report\",\"value\":\"text\"}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":0,\"operation\":\"preload-report\",\"payload\":{\"channel\":\"fixture:report\",\"value\":{}}}",
    "{\"version\":1,\"session\":\"" + secret + "\",\"request\":2,\"window\":2,\"generation\":3,\"operation\":\"preload-report\",\"payload\":{\"channel\":\"fixture:report\",\"value\":{},\"extra\":true}}",
  ] { assert_true(validate(raw) is Err(_)) }
}
