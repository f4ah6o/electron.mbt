///|
fn exact_identifier(token : String) -> Int64 raise BadProtocol {
  // Checking a parsed Double would already have lost fractional digits. Work
  // on the validated decimal token, without allocating a large integer/power.
  if token.length() == 0 || token[0].to_int() == 45 {
    raise BadProtocol("Invalid identifier token")
  }
  let mut digits = 0
  let mut fractional = 0
  let mut first = -1
  let mut last = -1
  let mut decimal = false
  let mut end = 0
  while end < token.length() {
    let c = token[end].to_int()
    if c == 101 || c == 69 { break }
    if c == 46 { decimal = true }
    else {
      if c < 48 || c > 57 { raise BadProtocol("Invalid identifier token") }
      if c != 48 {
        if first == -1 { first = digits }
        last = digits
      }
      digits += 1
      if decimal { fractional += 1 }
    }
    end += 1
  }
  // A zero mantissa is exactly zero for any finite textual exponent.
  if first == -1 { return 0L }
  let mut exponent = 0
  if end < token.length() {
    let mut i = end + 1
    let mut negative = false
    if i < token.length() && (token[i].to_int() == 43 || token[i].to_int() == 45) {
      negative = token[i].to_int() == 45
      i += 1
    }
    while i < token.length() {
      let c = token[i].to_int()
      if c < 48 || c > 57 { raise BadProtocol("Invalid identifier exponent") }
      // More than the wire-length bound cannot be cancelled by fractional or
      // trailing mantissa digits; saturation prevents integer overflow here.
      if exponent <= MaxBytes + 32 { exponent = exponent * 10 + c - 48 }
      i += 1
    }
    if negative { exponent = -exponent }
  }
  let scale = exponent - fractional + digits - last - 1
  if scale < 0 || last - first + 1 + scale > 16 {
    raise BadProtocol("Identifier is not an exact safe integer")
  }
  let mut result = 0L
  let mut index = 0
  for i = 0; i < end; i = i + 1 {
    let c = token[i].to_int()
    if c != 46 {
      if index >= first && index <= last {
        result = result * 10L + (c - 48).to_int64()
      }
      index += 1
    }
  }
  for i = 0; i < scale; i = i + 1 { result = result * 10L }
  if result > 9007199254740991L {
    raise BadProtocol("Identifier exceeds safe integer range")
  }
  result
}
