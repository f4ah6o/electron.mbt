///|
test "What: exact decimal identifiers cannot alias pending integers by rounding" {
  let session = Session::new("0123456789abcdef0123456789abcdef")
  assert_true(session.register(wire("1", "{}", "")) is Ok(_))
  for id in ["1.00000000000000001", "0.99999999999999999", "100000000000000001e-17", "1e-400", "9007199254740991.1", "9007199254740990.9"] {
    assert_true(validate(wire(id, "{}", "")) is Err(_))
    assert_true(session.accept(wire(id, "{\"visible\":true}", ",\"terminal\":\"success\"")) is Err(_))
    assert_eq(session.pending_count(), 1)
  }
  assert_true(session.accept(wire("1", "{\"visible\":true}", ",\"terminal\":\"success\"")) is Ok(_))
}

///|
test "What: exact integer decimal and exponent spellings remain valid" {
  for id in ["1.0", "100e-2", "0.01e2", "1.00000000000000000", "1e+0000", "9.007199254740991e15", "9007199254740991000e-3"] {
    assert_true(validate(wire(id, "{}", "")) is Ok(_))
  }
}
