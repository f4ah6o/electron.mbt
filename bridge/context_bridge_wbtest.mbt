///|
test "canonical bridge IDs cannot be rounded or coerced into another handle" {
  assert_eq(bridge_id("1"), Some(1))
  assert_eq(bridge_id("2147483647"), Some(2147483647))
  for token in ["", "0", "-0", "01", "+1", "-1", "1.0", "1e0", "2147483648", "1.00000000000000001"] {
    assert_eq(bridge_id(token.to_json()), None)
  }
  assert_eq(bridge_id(1), None)
  assert_eq(bridge_id(true), None)
}

///|
test "bridge metadata rejects nested collections before parsing" {
  assert_true(bridge_flat("{\"origin\":\"file:///a[1]/{x}\"}"))
  assert_false(bridge_flat("{\"origin\":{\"value\":\"file:///\"}}"))
  assert_false(bridge_flat("[]"))
  assert_false(bridge_flat("{\"origin\":\"unfinished}"))
}

///|
test "compiled bridge metadata stays fail closed without a host document" {
  let runtime = @core.Runtime::new()
  let raw = "{\"op\":\"register\",\"window\":\"1\",\"generation\":\"1\",\"origin\":\"file:///fixture/\",\"mainFrame\":true,\"channel\":\"read-text\",\"kind\":\"function\"}"
  let response = @json.parse(context_bridge_dispatch(runtime, raw))
  assert_true(field(response, "ok") is False)
  assert_eq(context_bridge_count(runtime), 0)
  assert_false(context_bridge_retained(runtime, 1))
}

///|
fn bridge_exposure_sha() -> String {
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}

///|
fn bridge_live_runtime() -> (@core.Runtime, Int32, Int32) {
  let runtime = @core.Runtime::new()
  runtime.ready() |> ignore
  let window = match runtime.reserve_window() {
    Ok(id) => id
    Err(_) => abort("bridge exposure fixture window reservation failed")
  }
  runtime.confirm_window(window) |> ignore
  let generation = match runtime.navigate(window) {
    Ok(value) => value
    Err(_) => abort("bridge exposure fixture navigation failed")
  }
  runtime.activate_document(window, generation, "file:///fixture/") |> ignore
  runtime.grant(window, generation, "read-text") |> ignore
  (runtime, window, generation)
}

///|
fn bridge_exposure_prefix(window : Int32, generation : Int32) -> String {
  "{\"op\":\"expose\",\"window\":\"" + window.to_string() +
  "\",\"generation\":\"" + generation.to_string() +
  "\",\"origin\":\"file:///fixture/\",\"mainFrame\":true,\"channel\":\"read-text\""
}

///|
fn bridge_exposure_valid(window : Int32, generation : Int32) -> String {
  bridge_exposure_prefix(window, generation) +
  ",\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":2,\"descriptorSha256\":\"" +
  bridge_exposure_sha() + "\"}"
}

///|
test "compiled exposure metadata allocates only for a valid trusted request" {
  let (runtime, window, generation) = bridge_live_runtime()
  let valid = bridge_exposure_valid(window, generation)
  let response = @json.parse(context_bridge_dispatch(runtime, valid))
  assert_true(field(response, "ok") is True)
  let id = match field(response, "id") {
    Number(number, ..) => number.to_int()
    _ => -1
  }
  assert_eq(id, 1)
  assert_eq(runtime.bridge_exposure_count(), 1)
  assert_eq(runtime.bridge_exposure_metrics(1),
    Some((128, 2, bridge_exposure_sha())))
  let release = "{\"op\":\"release-exposure\",\"window\":\"" + window.to_string() +
    "\",\"generation\":\"" + generation.to_string() +
    "\",\"origin\":\"file:///fixture/\",\"mainFrame\":true,\"channel\":\"read-text\"," +
    "\"id\":\"1\",\"apiKey\":\"fixture\"}"
  let released = @json.parse(context_bridge_dispatch(runtime, release))
  assert_true(field(released, "ok") is True)
  assert_true(field(released, "released") is True)
  assert_eq(runtime.bridge_exposure_count(), 0)
  let again = @json.parse(context_bridge_dispatch(runtime, release))
  assert_true(field(again, "ok") is True)
  assert_true(field(again, "released") is False)
}

///|
test "compiled exposure metadata rejects unknown extra missing and malformed fields" {
  let (runtime, window, generation) = bridge_live_runtime()
  let prefix = bridge_exposure_prefix(window, generation)
  let valid = bridge_exposure_valid(window, generation)
  let malformed = [
    prefix + "}",
    prefix + ",\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":2}",
    prefix + ",\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":2,\"descriptorSha256\":\"" +
      bridge_exposure_sha() + "\",\"extra\":true}",
    prefix + ",\"apiKey\":\"fixture\",\"descriptorBytes\":\"128\",\"functionCount\":2,\"descriptorSha256\":\"" +
      bridge_exposure_sha() + "\"}",
    prefix + ",\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":1.5,\"descriptorSha256\":\"" +
      bridge_exposure_sha() + "\"}",
    prefix + ",\"apiKey\":{},\"descriptorBytes\":128,\"functionCount\":2,\"descriptorSha256\":\"" +
      bridge_exposure_sha() + "\"}",
    prefix + ",\"apiKey\":\"window\",\"descriptorBytes\":128,\"functionCount\":2,\"descriptorSha256\":\"" +
      bridge_exposure_sha() + "\"}",
    prefix + ",\"apiKey\":\"fixture\",\"descriptorBytes\":0,\"functionCount\":2,\"descriptorSha256\":\"" +
      bridge_exposure_sha() + "\"}",
    prefix + ",\"apiKey\":\"fixture\",\"descriptorBytes\":128,\"functionCount\":257,\"descriptorSha256\":\"" +
      bridge_exposure_sha() + "\"}",
    "{\"op\":\"exposeInMainWorld\",\"window\":\"1\"}",
  ]
  for raw in malformed {
    let response = @json.parse(context_bridge_dispatch(runtime, raw))
    assert_true(field(response, "ok") is False)
  }
  assert_eq(runtime.bridge_exposure_count(), 0)
  let good = @json.parse(context_bridge_dispatch(runtime, valid))
  assert_true(field(good, "ok") is True)
  let duplicate = @json.parse(context_bridge_dispatch(runtime, valid))
  assert_true(field(duplicate, "ok") is False)
  assert_eq(field(duplicate, "code"), "Denied".to_json())
}

///|
test "compiled exposure release requires authority and the matching key" {
  let (runtime, window, generation) = bridge_live_runtime()
  let expose = @json.parse(context_bridge_dispatch(runtime, bridge_exposure_valid(window, generation)))
  assert_true(field(expose, "ok") is True)
  let release = "{\"op\":\"release-exposure\",\"window\":\"" + window.to_string() +
    "\",\"generation\":\"" + generation.to_string() +
    "\",\"origin\":\"https://attacker.invalid\",\"mainFrame\":true,\"channel\":\"read-text\"," +
    "\"id\":\"1\",\"apiKey\":\"fixture\"}"
  let denied = @json.parse(context_bridge_dispatch(runtime, release))
  assert_true(field(denied, "ok") is False)
  assert_eq(runtime.bridge_exposure_count(), 1)
  let wrong_key = "{\"op\":\"release-exposure\",\"window\":\"" + window.to_string() +
    "\",\"generation\":\"" + generation.to_string() +
    "\",\"origin\":\"file:///fixture/\",\"mainFrame\":true,\"channel\":\"read-text\"," +
    "\"id\":\"1\",\"apiKey\":\"other\"}"
  let mismatch = @json.parse(context_bridge_dispatch(runtime, wrong_key))
  assert_true(field(mismatch, "ok") is False)
  assert_eq(runtime.bridge_exposure_count(), 1)
}
