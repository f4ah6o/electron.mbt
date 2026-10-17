///|
test "native supervisor sessions are 32 lowercase hex characters" {
  let first = Bytes::new(32)
  assert_eq(supervisor_session(first), 32)
  let text = @utf8.decode_lossy(first)
  assert_eq(text.length(), 32)
  for i = 0; i < 32; i = i + 1 {
    let c = text[i].to_int()
    assert_true((c >= 48 && c <= 57) || (c >= 97 && c <= 102))
  }
  let second = Bytes::new(32)
  assert_eq(supervisor_session(second), 32)
  assert_true(first != second)
}
