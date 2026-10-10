///|
const MaxBytes = 1048576
///|
const MaxDepth = 64
///|
const MaxNodes = 100000
///|
const MaxPending = 256
///|
const MaxQueuedBytes = 4194304

///|
priv suberror BadProtocol {
  BadProtocol(String)
}

///|
pub fn limits() -> Json {
  {
    "version": 1, "bytes": MaxBytes.to_json(), "depth": MaxDepth.to_json(),
    "nodes": MaxNodes.to_json(), "pending": MaxPending.to_json(), "queuedBytes": MaxQueuedBytes.to_json(),
    "wireDepth": (MaxDepth + 1).to_json(), "wireNodes": (MaxNodes + 8).to_json(),
  }
}

///|
fn utf8_size(raw : String) -> Int raise BadProtocol {
  if raw.length() > MaxBytes { raise BadProtocol("Envelope exceeds byte limit") }
  let mut bytes = 0
  let mut i = 0
  while i < raw.length() {
    let c = raw[i].to_int()
    if c < 128 { bytes += 1 }
    else if c < 2048 { bytes += 2 }
    else if c >= 0xD800 && c <= 0xDBFF {
      if i + 1 >= raw.length() { raise BadProtocol("Unpaired surrogate") }
      let next = raw[i + 1].to_int()
      if next < 0xDC00 || next > 0xDFFF { raise BadProtocol("Unpaired surrogate") }
      bytes += 4
      i += 1
    } else if c >= 0xDC00 && c <= 0xDFFF {
      raise BadProtocol("Unpaired surrogate")
    } else { bytes += 3 }
    if bytes > MaxBytes { raise BadProtocol("Envelope exceeds byte limit") }
    i += 1
  }
  bytes
}

///|
priv struct WireParser {
  raw : String
  mut position : Int
  mut nodes : Int
}

///|
fn WireParser::peek(self : WireParser) -> Int {
  if self.position >= self.raw.length() { -1 }
  else { self.raw[self.position].to_int() }
}

///|
fn WireParser::whitespace(self : WireParser) -> Unit {
  while self.peek() == 32 || self.peek() == 9 || self.peek() == 10 || self.peek() == 13 {
    self.position += 1
  }
}

///|
fn WireParser::take(self : WireParser, code : Int) -> Unit raise BadProtocol {
  self.whitespace()
  if self.peek() != code { raise BadProtocol("Malformed JSON") }
  self.position += 1
}

///|
fn WireParser::string(self : WireParser) -> String raise BadProtocol {
  self.whitespace()
  let start = self.position
  self.take(34)
  let mut escaped = false
  while self.peek() != -1 {
    let c = self.peek()
    self.position += 1
    if escaped { escaped = false }
    else if c == 92 { escaped = true }
    else if c == 34 {
      let value = @json.parse(self.raw[start:self.position]) catch {
        _ => raise BadProtocol("Malformed JSON string")
      }
      match value {
        String(text) => {
          utf8_size(text) |> ignore
          return text
        }
        _ => raise BadProtocol("Expected string")
      }
    }
  }
  raise BadProtocol("Unterminated JSON string")
}

///|
fn WireParser::value(self : WireParser, depth : Int) -> Json raise BadProtocol {
  // The library parser discards duplicate member names; do not build its map
  // before comparing the decoded names in each object scope.
  if depth > MaxDepth + 1 || self.nodes >= MaxNodes + 8 {
    raise BadProtocol("JSON complexity limit exceeded")
  }
  self.nodes += 1
  self.whitespace()
  match self.peek() {
    123 => {
      self.position += 1
      let fields : Map[String, Json] = Map([])
      self.whitespace()
      if self.peek() == 125 { self.position += 1; return Json::object(fields) }
      while true {
        let key = self.string()
        if fields.contains(key) { raise BadProtocol("Duplicate JSON member") }
        self.take(58)
        fields[key] = self.value(depth + 1)
        self.whitespace()
        if self.peek() == 125 { self.position += 1; break }
        self.take(44)
      }
      Json::object(fields)
    }
    91 => {
      self.position += 1
      let values : Array[Json] = []
      self.whitespace()
      if self.peek() == 93 { self.position += 1; return values.to_json() }
      while true {
        values.push(self.value(depth + 1))
        self.whitespace()
        if self.peek() == 93 { self.position += 1; break }
        self.take(44)
      }
      values.to_json()
    }
    34 => self.string().to_json()
    _ => {
      let start = self.position
      while self.peek() != -1 && self.peek() != 44 && self.peek() != 93 && self.peek() != 125 && self.peek() != 32 && self.peek() != 9 && self.peek() != 10 && self.peek() != 13 {
        self.position += 1
      }
      if start == self.position { raise BadProtocol("Expected JSON value") }
      let value = @json.parse(self.raw[start:self.position]) catch {
        _ => raise BadProtocol("Malformed JSON scalar")
      }
      match value {
        Null | True | False => value
        Number(n, ..) => {
          if n - n != 0.0 || (n == 0.0 && 1.0 / n < 0.0) {
            raise BadProtocol("Unsupported JSON number")
          }
          Json::number(n, repr=self.raw[start:self.position].to_string())
        }
        _ => raise BadProtocol("Expected JSON scalar")
      }
    }
  }
}

///|
fn payload_ok(value : Json, depth : Int, remaining : Ref[Int]) -> Bool {
  if depth > MaxDepth || remaining.val <= 0 { return false }
  remaining.val -= 1
  match value {
    Object(fields) => {
      for key, child in fields {
        if key == "__proto__" || key == "constructor" || key == "prototype" { return false }
        if !payload_ok(child, depth + 1, remaining) { return false }
      }
      true
    }
    Array(values) => {
      for child in values {
        if !payload_ok(child, depth + 1, remaining) { return false }
      }
      true
    }
    _ => true
  }
}

///|
fn identifier(value : Json) -> Int64 raise BadProtocol {
  match value {
    Number(n, repr~) => {
      match repr {
        Some(token) => return exact_identifier(token)
        None => ()
      }
      if n < 0.0 || n > 9007199254740991.0 || n - n != 0.0 || (n == 0.0 && 1.0 / n < 0.0) {
        raise BadProtocol("Invalid identifier")
      }
      let id = n.to_int64()
      if id.to_double() != n { raise BadProtocol("Invalid identifier") }
      id
    }
    _ => raise BadProtocol("Invalid identifier")
  }
}

///|
fn session_valid(value : String) -> Bool {
  if value.length() != 32 { return false }
  for i = 0; i < value.length(); i = i + 1 {
    let c = value[i].to_int()
    if !((c >= 48 && c <= 57) || (c >= 97 && c <= 102)) { return false }
  }
  true
}

///|
priv struct Envelope {
  session : String
  request : Int64
  window : Int64
  generation : Int64
  operation : String
  terminal : Bool
  bytes : Int
}

///|
fn parse_wire(raw : String) -> Envelope raise BadProtocol {
  let bytes = utf8_size(raw)
  let parser = { raw, position: 0, nodes: 0 }
  let value = parser.value(0)
  parser.whitespace()
  if parser.position != raw.length() { raise BadProtocol("Trailing JSON input") }
  let fields = match value {
    Object(fields) => fields
    _ => raise BadProtocol("Envelope must be an object")
  }
  for key, _ in fields {
    match key {
      "version" | "session" | "request" | "window" | "generation" | "operation" | "payload" | "terminal" => ()
      _ => raise BadProtocol("Unknown envelope field")
    }
  }
  let field = fn(key) { fields.get(key).unwrap_or(null) }
  if identifier(field("version")) != 1L { raise BadProtocol("Unknown protocol version") }
  let session = match field("session") {
    String(s) if session_valid(s) => s
    _ => raise BadProtocol("Invalid session identifier")
  }
  let request = identifier(field("request"))
  if request == 0L { raise BadProtocol("Invalid request identifier") }
  let window = identifier(field("window"))
  let generation = identifier(field("generation"))
  let operation = match field("operation") {
    String(op) => match op {
      "hello" | "ready" | "create-window" | "show-window" | "hide-window" | "is-window-visible" | "begin-load" | "load-file" | "close-window" | "destroy-window" | "shutdown" | "web-content-gone" | "native-close-request" | "cancel-close" => op
      _ => raise BadProtocol("Unsupported operation")
    }
    _ => raise BadProtocol("Invalid operation")
  }
  let payload = field("payload")
  if !(payload is Object(_)) || !payload_ok(payload, 0, Ref(MaxNodes)) {
    raise BadProtocol("Unsupported or excessive payload")
  }
  let terminal = fields.contains("terminal")
  if terminal {
    match field("terminal") {
      String("success" | "failure" | "cancelled") => ()
      _ => raise BadProtocol("Invalid terminal result")
    }
  }
  { session, request, window, generation, operation, terminal, bytes }
}

///|
pub fn validate(raw : String) -> Result[Unit, String] {
  try { parse_wire(raw) |> ignore; Ok(()) }
  catch { BadProtocol(message) => Err(message) }
}
