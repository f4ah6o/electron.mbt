///|
// Adapted-profile custom-scheme admission. The native host serves admitted
// schemes from an asset directory allowlist; this module owns the naming,
// privilege and content-type policy so the CLI, the prelude tests and the host
// reject the same inputs. URL decoding and realpath containment stay in the
// host, where the actual file is opened.
const PROTOCOL_MAX_SCHEMES : Int = 4

///|
const PROTOCOL_MAX_PATH : Int = 4096

///|
const PROTOCOL_MAX_ASSET_BYTES : Int = 4 * 1024 * 1024

///|
pub fn protocol_max_asset_bytes() -> Int {
  PROTOCOL_MAX_ASSET_BYTES
}

///|
fn protocol_scheme_char_allowed(code : Int) -> Bool {
  (code >= 97 && code <= 122) ||
  (code >= 48 && code <= 57) ||
  code == 43 ||
  code == 45 ||
  code == 46
}

///|
fn protocol_reserved_scheme(scheme : String) -> Bool {
  scheme == "http" ||
  scheme == "https" ||
  scheme == "file" ||
  scheme == "data" ||
  scheme == "blob" ||
  scheme == "about" ||
  scheme == "javascript" ||
  scheme == "electron-mbt-app"
}

///|
/// Returns a diagnostic code when `scheme` is not a custom scheme this adapted
/// profile may admit. Lowercase RFC 3986 scheme syntax only; three characters
/// minimum keeps single-letter Windows drive-like names out.
pub fn protocol_scheme_error(scheme : String) -> String? {
  if scheme.length() < 3 || scheme.length() > 32 {
    return Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
  }
  let first = scheme[0].to_int()
  if first < 97 || first > 122 {
    return Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
  }
  for i = 1; i < scheme.length(); i = i + 1 {
    if !protocol_scheme_char_allowed(scheme[i].to_int()) {
      return Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
    }
  }
  if protocol_reserved_scheme(scheme) {
    return Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
  }
  None
}

///|
/// Validates the `assetSchemes` list from a staged manifest. The caller passes
/// only names; privileges are declared by the app at runtime and checked
/// separately.
pub fn admit_asset_schemes(schemes : Array[String]) -> Result[Unit, String] {
  if schemes.length() > PROTOCOL_MAX_SCHEMES {
    return Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
  }
  for i = 0; i < schemes.length(); i = i + 1 {
    match protocol_scheme_error(schemes[i]) {
      Some(code) => return Err(code)
      None => ()
    }
    for j = 0; j < i; j = j + 1 {
      if schemes[i] == schemes[j] {
        return Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
      }
    }
  }
  Ok(())
}

///|
fn protocol_privilege_allowed(name : String) -> Bool {
  name == "standard" ||
  name == "secure" ||
  name == "supportFetchAPI" ||
  name == "corsEnabled"
}

///|
/// `privileges` may be absent (null). Every declared privilege must be one the
/// asset broker can honor and must be `true`; `bypassCSP`, service workers,
/// code cache and streaming are rejected rather than ignored.
pub fn protocol_privilege_error(privileges : Json) -> String? {
  match privileges {
    Null => None
    Object(fields) => {
      for name, value in fields {
        if !protocol_privilege_allowed(name) {
          return Some("ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE")
        }
        if !(value is True) {
          return Some("ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE")
        }
      }
      None
    }
    _ => Some("ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE")
  }
}

///|
fn protocol_extension(path : String) -> String {
  let mut dot = -1
  let mut slash = -1
  for i = 0; i < path.length(); i = i + 1 {
    let code = path[i].to_int()
    if code == 46 {
      dot = i
    } else if code == 47 || code == 92 {
      slash = i
    }
  }
  if dot <= slash || dot + 1 >= path.length() {
    return ""
  }
  path[dot + 1:].to_lower().to_owned()
}

///|
pub fn protocol_asset_extension_allowed(path : String) -> Bool {
  match protocol_extension(path) {
    "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "ico" | "svg" =>
      true
    _ => false
  }
}

///|
pub fn protocol_asset_content_type(path : String) -> String {
  match protocol_extension(path) {
    "png" => "image/png"
    "jpg" | "jpeg" => "image/jpeg"
    "gif" => "image/gif"
    "webp" => "image/webp"
    "avif" => "image/avif"
    "bmp" => "image/bmp"
    "ico" => "image/x-icon"
    "svg" => "image/svg+xml"
    _ => "application/octet-stream"
  }
}

///|
/// Lexical containment only: canonicalization and symlink decisions belong to
/// the host, which has the opened file and the realpath grant. This predicate
/// rejects a path that cannot be inside `root` even after canonicalization.
pub fn protocol_path_within(path : String, root : String) -> Bool {
  if root == "/" {
    return path.has_prefix("/")
  }
  if path == root {
    return true
  }
  path.length() > root.length() &&
  path.has_prefix(root) &&
  path[root.length()] == '/'
}

///|
/// Rejects paths the broker must never hand to a filesystem call. `..` is
/// rejected lexically even when it would resolve back inside the allowlist, so
/// the URL and the opened path stay easy to audit.
pub fn protocol_path_error(path : String) -> String? {
  if path.length() == 0 || path.length() > PROTOCOL_MAX_PATH {
    return Some("ELECTRON_MBT_PROTOCOL_INVALID_PATH")
  }
  if !path.has_prefix("/") {
    return Some("ELECTRON_MBT_PROTOCOL_INVALID_PATH")
  }
  for part in path.split("/") {
    if part == ".." {
      return Some("ELECTRON_MBT_PROTOCOL_INVALID_PATH")
    }
  }
  for i = 0; i < path.length(); i = i + 1 {
    if path[i].to_int() == 0 {
      return Some("ELECTRON_MBT_PROTOCOL_INVALID_PATH")
    }
  }
  None
}

///|
/// Validates the `assetSchemes` field of a staged adapted manifest. A missing
/// field is an empty list; a present non-array or invalid entry is rejected.
pub fn protocol_manifest_asset_schemes(value : Json) -> Result[Array[String], String] {
  match value {
    Null => Ok([])
    Array(items) => {
      let schemes : Array[String] = []
      for item in items {
        match item {
          String(scheme) => schemes.push(scheme)
          _ => return Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
        }
      }
      match admit_asset_schemes(schemes) {
        Ok(_) => Ok(schemes)
        Err(code) => Err(code)
      }
    }
    _ => Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME")
  }
}
