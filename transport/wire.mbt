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
fn bounds_value(value : Json, dimension : Bool) -> Bool {
  match value {
    Number(number, repr~) => {
      if number - number != 0.0 || (number == 0.0 && 1.0 / number < 0.0) {
        return false
      }
      let exact = match repr {
        Some(token) => {
          if token.length() > 0 && token[0].to_int() == 45 {
            let magnitude = exact_identifier(token[1:token.length()].to_owned()) catch {
              _ => return false
            }
            0L - magnitude
          } else {
            exact_identifier(token) catch { _ => return false }
          }
        }
        None => {
          if number < -1048576.0 || number > 1048576.0 ||
             number.to_int64().to_double() != number { return false }
          number.to_int64()
        }
      }
      if dimension { exact > 0L && exact <= 32768L }
      else { exact >= -1048576L && exact <= 1048576L }
    }
    _ => false
  }
}

///|
fn min_size_value(value : Json) -> Bool {
  match value {
    Number(number, repr~) => {
      if number - number != 0.0 || (number == 0.0 && 1.0 / number < 0.0) {
        return false
      }
      let exact = match repr {
        Some(token) => exact_identifier(token) catch { _ => return false }
        None =>
          if number < 0.0 || number > 4096.0 || number.to_int64().to_double() != number {
            return false
          } else {
            number.to_int64()
          }
      }
      exact >= 0L && exact <= 4096L
    }
    _ => false
  }
}

///|
fn color_value(value : Json) -> Bool {
  match value {
    String(text) if text.length() == 7 && text[0] == '#' => {
      for i = 1; i < 7; i = i + 1 {
        let c = text[i].to_int()
        if !((c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)) {
          return false
        }
      }
      true
    }
    _ => false
  }
}

///|
fn writable_bounds_value(value : Json, dimension : Bool) -> Bool {
  if !bounds_value(value, dimension) { return false }
  if !dimension { return true }
  match value {
    Number(number, ..) => number >= 100.0 && number <= 4096.0
    _ => false
  }
}

///|
priv struct Envelope {
  session : String
  request : Int64
  window : Int64
  generation : Int64
  operation : String
  terminal : Bool
  success : Bool
  title : String
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
      "hello" | "ready" | "create-window" | "show-window" | "hide-window" | "is-window-visible" | "get-window-title" | "set-window-title" | "get-window-bounds" | "set-window-bounds" | "get-window-min-size" | "set-window-min-size" | "get-window-background-color" | "set-window-background-color" | "get-preload-status" | "get-web-contents-url" | "get-web-contents-title" | "get-bootstrap-status" | "get-adapted-status" | "prepare-source" | "grant-file" | "set-dialog-result" | "probe-renderer" | "trigger-renderer-api" | "open-dialog-ui" | "cancel-active-dialog" | "get-dialog-ui-status" | "get-document-identity" | "get-ingress-status" | "release-adapted-ingress" | "trigger-adapted-ingress" | "dispatch-adapted-event" | "install-adapted-adapter" | "begin-load" | "load-file" | "load-app-file" | "load-url" | "close-window" | "destroy-window" | "shutdown" | "web-content-gone" | "native-close-request" | "isolated-preload-attested" | "preload-exposure" | "preload-report" | "install-preload-bridge" | "cancel-close" => op
      _ => raise BadProtocol("Unsupported operation")
    }
    _ => raise BadProtocol("Invalid operation")
  }
  let payload = field("payload")
  if !(payload is Object(_)) || !payload_ok(payload, 0, Ref(MaxNodes)) {
    raise BadProtocol("Unsupported or excessive payload")
  }
  if operation == "isolated-preload-attested" {
    match payload {
      Object(values) if values.length() == 0 => ()
      _ => raise BadProtocol("Native isolated-preload attestation must have empty payload")
    }
    if generation <= 0L { raise BadProtocol("Attestation requires a live document generation") }
  }
  if operation == "install-preload-bridge" {
    let values = match payload {
      Object(values) => values
      _ => raise BadProtocol("Preload bridge payload must be an object")
    }
    // The success acknowledgement carries {installed:true}; the request carries
    // the bounded host-owned sources/digests, the discovered API key and the
    // preview exposure metadata. Keep both shapes exact.
    if values.length() == 1 {
      match values.get("installed") {
        Some(True) | Some(False) => ()
        _ => raise BadProtocol("Preload bridge acknowledgement shape")
      }
    } else if values.length() == 8 {
      for key in ["codecSource", "pageShimSource", "isolatedSource"] {
        match values.get(key) {
          Some(String(value)) if value.length() > 0 && value.length() <= 262144 => ()
          _ => raise BadProtocol("Preload bridge source")
        }
      }
      let api_key = match values.get("apiKey") {
        Some(String(value)) if value.length() > 0 && value.length() <= 64 => value
        _ => raise BadProtocol("Preload bridge api key")
      }
      let exposure = match values.get("exposure") {
        Some(Object(exposure)) => exposure
        _ => raise BadProtocol("Preload bridge exposure")
      }
      if exposure.length() != 4 { raise BadProtocol("Preload bridge exposure shape") }
      let exposure_key = match exposure.get("apiKey") {
        Some(String(value)) if value == api_key => value
        _ => raise BadProtocol("Preload bridge exposure api key")
      }
      ignore(exposure_key)
      let descriptor_bytes = identifier(exposure.get("descriptorBytes").unwrap_or(null))
      if descriptor_bytes < 1L || descriptor_bytes > 65536L {
        raise BadProtocol("Preload bridge exposure bytes")
      }
      let function_count = identifier(exposure.get("functionCount").unwrap_or(null))
      if function_count < 0L || function_count > 256L {
        raise BadProtocol("Preload bridge exposure functions")
      }
      let exposure_sha = match exposure.get("descriptorSHA256") {
        Some(String(value)) => value
        _ => raise BadProtocol("Preload bridge exposure digest")
      }
      if exposure_sha.length() != 64 { raise BadProtocol("Preload bridge exposure digest") }
      for i = 0; i < exposure_sha.length(); i = i + 1 {
        let c = exposure_sha[i].to_int()
        if !((c >= 48 && c <= 57) || (c >= 97 && c <= 102)) {
          raise BadProtocol("Preload bridge exposure digest")
        }
      }
      for key in ["codecSHA256", "pageShimSHA256", "isolatedSHA256"] {
        let digest = match values.get(key) {
          Some(String(value)) => value
          _ => raise BadProtocol("Preload bridge digest")
        }
        if digest.length() != 64 { raise BadProtocol("Preload bridge digest") }
        for i = 0; i < digest.length(); i = i + 1 {
          let c = digest[i].to_int()
          if !((c >= 48 && c <= 57) || (c >= 97 && c <= 102)) {
            raise BadProtocol("Preload bridge digest")
          }
        }
      }
    } else {
      raise BadProtocol("Preload bridge payload shape")
    }
  }
  if operation == "preload-report" {
    if generation <= 0L { raise BadProtocol("Preload report requires a live document generation") }
    let values = match payload {
      Object(values) => values
      _ => raise BadProtocol("Preload report payload must be an object")
    }
    if values.length() != 2 { raise BadProtocol("Preload report payload shape") }
    match values.get("channel") {
      Some(String(value)) if value.length() > 0 && value.length() <= 256 => ()
      _ => raise BadProtocol("Preload report channel")
    }
    match values.get("value") {
      Some(Object(_)) => ()
      _ => raise BadProtocol("Preload report value")
    }
  }
  if operation == "preload-exposure" {
    if generation <= 0L { raise BadProtocol("Exposure requires a live document generation") }
    let values = match payload {
      Object(values) => values
      _ => raise BadProtocol("Exposure payload must be an object")
    }
    if values.length() != 4 { raise BadProtocol("Exposure payload shape") }
    let api_key = match values.get("apiKey") {
      Some(String(value)) => value
      _ => raise BadProtocol("Exposure api key")
    }
    if api_key.length() == 0 || api_key.length() > 64 { raise BadProtocol("Exposure api key") }
    let descriptor_bytes = identifier(values.get("descriptorBytes").unwrap_or(null))
    if descriptor_bytes < 1L || descriptor_bytes > 65536L {
      raise BadProtocol("Exposure descriptor bytes")
    }
    let function_count = identifier(values.get("functionCount").unwrap_or(null))
    if function_count < 0L || function_count > 256L {
      raise BadProtocol("Exposure function count")
    }
    let digest = match values.get("descriptorSHA256") {
      Some(String(value)) => value
      _ => raise BadProtocol("Exposure digest")
    }
    if digest.length() != 64 { raise BadProtocol("Exposure digest") }
    for i = 0; i < digest.length(); i = i + 1 {
      let c = digest[i].to_int()
      if !((c >= 48 && c <= 57) || (c >= 97 && c <= 102)) {
        raise BadProtocol("Exposure digest")
      }
    }
  }
  let terminal = fields.contains("terminal")
  let success = field("terminal") is String("success")
  let mut title = ""
  if operation == "get-window-title" || operation == "set-window-title" {
    if !terminal && operation == "get-window-title" {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid get-window-title request")
      }
    } else if !terminal || success {
      title = match payload {
        Object(values) if values.length() == 1 => {
          match values.get("title") {
            Some(String(value)) if value.length() <= 256 => value
            _ => raise BadProtocol("Invalid native window title")
          }
        }
        _ => raise BadProtocol("Invalid native window title")
      }
    }
  }
  if operation == "get-window-bounds" || operation == "set-window-bounds" {
    if !terminal {
      match payload {
        Object(values) if operation == "get-window-bounds" && values.length() == 0 => ()
        Object(values) if operation == "set-window-bounds" && values.length() <= 4 => {
          for key, value in values {
            match key {
              "x" | "y" => {
                if !writable_bounds_value(value, false) { raise BadProtocol("Invalid window position") }
              }
              "width" | "height" => {
                if !writable_bounds_value(value, true) { raise BadProtocol("Invalid window dimension") }
              }
              _ => raise BadProtocol("Unknown window bounds field")
            }
          }
        }
        _ => raise BadProtocol("Invalid window bounds request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 4 => {
          if !bounds_value(values.get("x").unwrap_or(null), false) ||
             !bounds_value(values.get("y").unwrap_or(null), false) ||
             !bounds_value(values.get("width").unwrap_or(null), true) ||
             !bounds_value(values.get("height").unwrap_or(null), true) {
            raise BadProtocol("Invalid native window bounds")
          }
        }
        _ => raise BadProtocol("Invalid native window bounds")
      }
    }
  }
  if operation == "get-window-min-size" || operation == "set-window-min-size" {
    if !terminal {
      match payload {
        Object(values) if operation == "get-window-min-size" && values.length() == 0 => ()
        Object(values) if operation == "set-window-min-size" && values.length() == 2 &&
          min_size_value(values.get("width").unwrap_or(null)) &&
          min_size_value(values.get("height").unwrap_or(null)) => ()
        _ => raise BadProtocol("Invalid window minimum-size request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 2 &&
          min_size_value(values.get("width").unwrap_or(null)) &&
          min_size_value(values.get("height").unwrap_or(null)) => ()
        _ => raise BadProtocol("Invalid native window minimum size")
      }
    }
  }
  if operation == "get-preload-status" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid preload-status request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 2 => {
          let status = values.get("status").unwrap_or(null)
          let detail = values.get("detail").unwrap_or(null)
          match status {
            String(value) if value == "ok" || value == "unsupported" ||
              value == "failed" || value == "absent" => ()
            _ => raise BadProtocol("Invalid native preload status")
          }
          match detail {
            String(value) if value.length() <= 128 => ()
            _ => raise BadProtocol("Invalid native preload detail")
          }
        }
        _ => raise BadProtocol("Invalid native preload status")
      }
    }
  }
  if operation == "get-window-background-color" || operation == "set-window-background-color" {
    if !terminal {
      match payload {
        Object(values) if operation == "get-window-background-color" && values.length() == 0 => ()
        Object(values) if operation == "set-window-background-color" && values.length() == 1 &&
          color_value(values.get("color").unwrap_or(null)) => ()
        _ => raise BadProtocol("Invalid window background-colour request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 &&
          color_value(values.get("color").unwrap_or(null)) => ()
        _ => raise BadProtocol("Invalid native window background colour")
      }
    }
  }
  if operation == "get-web-contents-url" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid get-web-contents-url request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("url") {
            Some(String(value)) if value.length() <= 8192 => ()
            _ => raise BadProtocol("Invalid native web contents URL")
          }
        }
        _ => raise BadProtocol("Invalid native web contents URL")
      }
    }
  }
  if operation == "get-web-contents-title" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid get-web-contents-title request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("title") {
            Some(String(value)) if value.length() <= 4096 => ()
            _ => raise BadProtocol("Invalid native web contents title")
          }
        }
        _ => raise BadProtocol("Invalid native web contents title")
      }
    }
  }
  if operation == "install-adapted-adapter" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("file") {
            Some(String(value)) if value.length() > 0 && value.length() <= 8192 => ()
            _ => raise BadProtocol("Invalid adapted-adapter file")
          }
        }
        _ => raise BadProtocol("Invalid adapted-adapter request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 && values.get("installed") is Some(True) => ()
        _ => raise BadProtocol("Invalid adapted-adapter acknowledgement")
      }
    }
  }
  if operation == "get-bootstrap-status" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid bootstrap status request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 4 => {
          let observed = match values.get("observed") {
            Some(True) => true
            Some(False) => false
            _ => raise BadProtocol("Invalid native bootstrap observation")
          }
          let main_frame = match values.get("mainFrame") {
            Some(True) => true
            Some(False) => false
            _ => raise BadProtocol("Invalid bootstrap frame flag")
          }
          if observed != main_frame ||
             identifier(values.get("generation").unwrap_or(null)) != generation {
            raise BadProtocol("Mismatched native bootstrap identity")
          }
          match values.get("documentURL") {
            Some(String(url)) if url.length() <= 8192 && ((url != "") == observed) => ()
            _ => raise BadProtocol("Invalid bootstrap document URL")
          }
        }
        _ => raise BadProtocol("Malformed native bootstrap status")
      }
    }
  }
  if operation == "get-adapted-status" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid adapted status request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 4 => {
          let observed = match values.get("observed") {
            Some(True) => true
            Some(False) => false
            _ => raise BadProtocol("Invalid adapted installation observation")
          }
          let before_load = match values.get("documentStartBeforeLoad") {
            Some(True) => true
            Some(False) => false
            _ => raise BadProtocol("Invalid adapted document-start flag")
          }
          // A document-start observation cannot be claimed after LoadComplete.
          if observed && !before_load {
            raise BadProtocol("Adapted installation must precede LoadComplete")
          }
          if identifier(values.get("generation").unwrap_or(null)) != generation {
            raise BadProtocol("Mismatched adapted document generation")
          }
          match values.get("ingress") {
            Some(String("absent")) => ()
            _ => raise BadProtocol("Invalid adapted ingress state")
          }
        }
        _ => raise BadProtocol("Malformed native adapted status")
      }
    }
  }
  if operation == "prepare-source" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("file") {
            Some(String(file)) if file.length() > 0 && file.length() <= 256 &&
              !file.has_prefix("/") && !file.contains("..") => ()
            _ => raise BadProtocol("Invalid source file")
          }
        }
        _ => raise BadProtocol("Invalid prepare-source request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 6 => {
          match values.get("prepared") {
            Some(True) => ()
            _ => raise BadProtocol("Invalid source snapshot acknowledgement")
          }
          match values.get("sha256") {
            Some(String(hash)) if hash.length() == 64 => ()
            _ => raise BadProtocol("Invalid source snapshot hash")
          }
          let bytes = identifier(values.get("bytes").unwrap_or(null))
          if bytes <= 0L || bytes > 16777216L {
            raise BadProtocol("Invalid source snapshot size")
          }
          let files = identifier(values.get("files").unwrap_or(null))
          if files <= 0L || files > 4096L {
            raise BadProtocol("Invalid source snapshot file count")
          }
          match values.get("manifestSHA256") {
            Some(String(hash)) if hash.length() == 64 => ()
            _ => raise BadProtocol("Invalid source manifest hash")
          }
          match values.get("root") {
            Some(String(root)) if root.length() > 0 && root.length() <= 4096 => ()
            _ => raise BadProtocol("Invalid source snapshot root")
          }
        }
        _ => raise BadProtocol("Malformed source snapshot acknowledgement")
      }
    }
  }
  if operation == "open-dialog-ui" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid open-dialog-ui request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("opened") { Some(True) => (); _ => raise BadProtocol("Invalid open-dialog-ui acknowledgement") }
        }
        _ => raise BadProtocol("Malformed open-dialog-ui acknowledgement")
      }
    }
  }
  if operation == "cancel-active-dialog" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid cancel-active-dialog request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("canceled") { Some(True) => (); _ => raise BadProtocol("Invalid cancel-active-dialog acknowledgement") }
        }
        _ => raise BadProtocol("Malformed cancel-active-dialog acknowledgement")
      }
    }
  }
  if operation == "get-dialog-ui-status" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid dialog UI status request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 3 => {
          match values.get("opened") { Some(True) | Some(False) => (); _ => raise BadProtocol("Invalid dialog UI opened") }
          match values.get("completed") { Some(True) | Some(False) => (); _ => raise BadProtocol("Invalid dialog UI completed") }
          match values.get("canceled") { Some(True) | Some(False) => (); _ => raise BadProtocol("Invalid dialog UI canceled") }
        }
        _ => raise BadProtocol("Malformed dialog UI status")
      }
    }
  }
  if operation == "trigger-renderer-api" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid renderer API probe request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("started") {
            Some(True) => ()
            _ => raise BadProtocol("Invalid renderer API probe acknowledgement")
          }
        }
        _ => raise BadProtocol("Malformed renderer API probe acknowledgement")
      }
    }
  }
  if operation == "probe-renderer" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid renderer probe request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 5 => {
          match values.get("api") {
            Some(True) | Some(False) => ()
            _ => raise BadProtocol("Invalid renderer probe api")
          }
          let children = identifier(values.get("rootChildren").unwrap_or(null))
          if children < 0L || children > 100000L {
            raise BadProtocol("Invalid renderer probe child count")
          }
          match values.get("title") {
            Some(String(title)) if title.length() <= 256 => ()
            _ => raise BadProtocol("Invalid renderer probe title")
          }
          match values.get("text") {
            Some(String(text)) if text.length() <= 1024 => ()
            _ => raise BadProtocol("Invalid renderer probe text")
          }
          match values.get("apiProbe") {
            Some(String(value)) if value.length() <= 2048 => ()
            _ => raise BadProtocol("Invalid renderer API probe")
          }
        }
        _ => raise BadProtocol("Malformed renderer probe acknowledgement")
      }
    }
  }
  if operation == "set-dialog-result" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 2 => {
          match values.get("kind") {
            Some(String(kind)) if kind == "open" || kind == "save" || kind == "export-html" || kind == "export-png" || kind == "export-pdf" || kind == "export-doc-png" => ()
            _ => raise BadProtocol("Invalid dialog result kind")
          }
          match values.get("path") {
            Some(String(path)) if path.length() > 0 && path.length() <= 4096 => ()
            _ => raise BadProtocol("Invalid dialog result path")
          }
        }
        _ => raise BadProtocol("Invalid dialog result request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 3 => {
          match values.get("set") {
            Some(True) => ()
            _ => raise BadProtocol("Invalid dialog result acknowledgement")
          }
          match values.get("kind") {
            Some(String(kind)) if kind == "open" || kind == "save" || kind == "export-html" || kind == "export-png" || kind == "export-pdf" || kind == "export-doc-png" => ()
            _ => raise BadProtocol("Invalid dialog result kind")
          }
          match values.get("path") {
            Some(String(path)) if path.length() > 0 && path.length() <= 4096 => ()
            _ => raise BadProtocol("Invalid dialog result path")
          }
        }
        _ => raise BadProtocol("Malformed dialog result acknowledgement")
      }
    }
  }
  if operation == "grant-file" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 2 => {
          match values.get("path") {
            Some(String(path)) if path.length() > 0 && path.length() <= 4096 => ()
            _ => raise BadProtocol("Invalid file grant path")
          }
          match values.get("mode") {
            Some(String(mode)) if mode == "read" || mode == "write" || mode == "readwrite" => ()
            _ => raise BadProtocol("Invalid file grant mode")
          }
        }
        _ => raise BadProtocol("Invalid file grant request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 3 => {
          match values.get("granted") {
            Some(True) => ()
            _ => raise BadProtocol("Invalid file grant acknowledgement")
          }
          match values.get("path") {
            Some(String(path)) if path.length() > 0 && path.length() <= 4096 => ()
            _ => raise BadProtocol("Invalid file grant path")
          }
          match values.get("mode") {
            Some(String(mode)) if mode == "read" || mode == "write" || mode == "readwrite" => ()
            _ => raise BadProtocol("Invalid file grant mode")
          }
        }
        _ => raise BadProtocol("Malformed file grant acknowledgement")
      }
    }
  }
  if operation == "get-document-identity" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid document identity request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 4 => {
          if identifier(values.get("generation").unwrap_or(null)) != generation {
            raise BadProtocol("Mismatched document identity generation")
          }
          let source = match values.get("source") {
            Some(String(value)) => value
            _ => raise BadProtocol("Invalid document identity source")
          }
          let hash = match values.get("sha256") {
            Some(String(value)) => value
            _ => raise BadProtocol("Invalid document identity hash")
          }
          let manifest_hash = match values.get("manifestSHA256") {
            Some(String(value)) => value
            _ => raise BadProtocol("Invalid document manifest hash")
          }
          if (source == "snapshot" && (hash.length() != 64 || manifest_hash.length() != 64)) ||
             (source == "app" && (hash.length() != 0 || manifest_hash.length() != 0)) ||
             (source != "snapshot" && source != "app") {
            raise BadProtocol("Inconsistent document identity")
          }
        }
        _ => raise BadProtocol("Malformed document identity")
      }
    }
  }
  if operation == "get-ingress-status" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid ingress status request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 5 => {
          let admitted = identifier(values.get("admitted").unwrap_or(null))
          let denied = identifier(values.get("denied").unwrap_or(null))
          let unhandled = identifier(values.get("unhandled").unwrap_or(null))
          if admitted < 0L || denied < 0L || unhandled < 0L {
            raise BadProtocol("Invalid ingress counters")
          }
          match values.get("lastCode") {
            Some(String(code)) if code.length() <= 128 => ()
            _ => raise BadProtocol("Invalid ingress code")
          }
          if identifier(values.get("generation").unwrap_or(null)) != generation {
            raise BadProtocol("Mismatched ingress generation")
          }
        }
        _ => raise BadProtocol("Malformed ingress status")
      }
    }
  }
  if operation == "release-adapted-ingress" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid ingress release request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("released") {
            Some(True) => ()
            _ => raise BadProtocol("Invalid ingress release acknowledgement")
          }
        }
        _ => raise BadProtocol("Malformed ingress release acknowledgement")
      }
    }
  }
  if operation == "trigger-adapted-ingress" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 0 => ()
        _ => raise BadProtocol("Invalid ingress trigger request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 1 => {
          match values.get("triggered") {
            Some(True) => ()
            _ => raise BadProtocol("Invalid ingress trigger acknowledgement")
          }
        }
        _ => raise BadProtocol("Malformed ingress trigger acknowledgement")
      }
    }
  }
  if operation == "dispatch-adapted-event" {
    if !terminal {
      match payload {
        Object(values) if values.length() == 2 => {
          let topic_ok = match values.get("topic") {
            Some(String(topic)) =>
              topic == "doc:open" || topic == "app:request-close" || topic == "update:state"
            _ => false
          }
          if !topic_ok { raise BadProtocol("Invalid adapted event topic") }
          match values.get("value") {
            Some(String(value)) if value.length() > 0 && value.length() <= 256 => ()
            _ => raise BadProtocol("Invalid adapted event value")
          }
        }
        _ => raise BadProtocol("Invalid adapted event request")
      }
    } else if success {
      match payload {
        Object(values) if values.length() == 3 => {
          match values.get("delivered") {
            Some(True) => ()
            _ => raise BadProtocol("Invalid adapted event delivery")
          }
          let topic_ok = match values.get("topic") {
            Some(String(topic)) =>
              topic == "doc:open" || topic == "app:request-close" || topic == "update:state"
            _ => false
          }
          if !topic_ok { raise BadProtocol("Invalid adapted event topic") }
          if identifier(values.get("generation").unwrap_or(null)) != generation {
            raise BadProtocol("Mismatched adapted event generation")
          }
        }
        _ => raise BadProtocol("Malformed adapted event delivery")
      }
    }
  }
  if terminal {
    match field("terminal") {
      String("success") => {
        match operation {
          "show-window" | "hide-window" | "is-window-visible" => {
            let visible = match payload {
              Object(values) if values.length() == 1 => {
                match values.get("visible") {
                  Some(True) => true
                  Some(False) => false
                  _ => raise BadProtocol("Invalid native visibility acknowledgement")
                }
              }
              _ => raise BadProtocol("Invalid native visibility acknowledgement")
            }
            if (operation == "show-window" && !visible) ||
               (operation == "hide-window" && visible) {
              raise BadProtocol("Native visibility acknowledgement mismatch")
            }
          }
          _ => ()
        }
      }
      String("failure" | "cancelled") => ()
      _ => raise BadProtocol("Invalid terminal result")
    }
  }
  { session, request, window, generation, operation, terminal, success, title, bytes }
}

///|
pub fn validate(raw : String) -> Result[Unit, String] {
  try { parse_wire(raw) |> ignore; Ok(()) }
  catch { BadProtocol(message) => Err(message) }
}
