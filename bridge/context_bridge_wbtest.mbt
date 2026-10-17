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
