///|
fn profile_field(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn profile_text(value : Json, key : String) -> String {
  match profile_field(value, key) {
    String(text) => text
    _ => ""
  }
}

///|
fn profile_texts(value : Json) -> Array[String] {
  let out : Array[String] = []
  match value {
    Array(items) =>
      for item in items {
        match item {
          String(text) =>
            if text.length() > 0 {
              out.push(text)
            }
          _ => ()
        }
      }
    _ => ()
  }
  out
}

///|
fn profile_contains(values : Array[String], wanted : String) -> Bool {
  for value in values {
    if value == wanted {
      return true
    }
  }
  false
}

///|
fn profile_rejected(code : String, field : String, profile : String) -> Json {
  {
    "ok": false,
    "code": code,
    "field": field,
    "profile": profile,
    "compatible": false,
  }
}

///|
fn profile_known_implementation(value : String) -> Bool {
  value == "planned" ||
  value == "partial" ||
  value == "implemented" ||
  value == "unsupported"
}

///|
fn profile_known_verification(value : String) -> Bool {
  value == "not-run" ||
  value == "invalid-evidence" ||
  value == "failed" ||
  value == "passed"
}

///|
fn profile_known_gate(value : String) -> Bool {
  value == "open" || value == "blocked" || value == "satisfied"
}

///|
fn profile_known_engine(value : String) -> Bool {
  value == "node" || value == "quickjs" || value == "moonbit"
}

///|
fn profile_known_runtime(value : String) -> Bool {
  value == "node-backed" ||
  value == "quickjs-native" ||
  value == "moonbit-native"
}

///|
// Admission is deliberately narrower than compatibility. A recognized profile
// may be open or blocked; only a known profile whose selections are allowed is
// admitted, and no profile is allowed to claim `compatible:true` here.
pub fn validate_profile(
  config : Json,
  requested : String,
  input_mode : String,
  preload_mode : String,
  runtime : String,
) -> Json {
  if requested.length() == 0 ||
    requested.length() > 128 ||
    input_mode.length() > 128 ||
    preload_mode.length() > 128 ||
    runtime.length() > 128 {
    return { "ok": false, "code": "InvalidPayload", "compatible": false }
  }
  guard config is Object(_) else {
    return { "ok": false, "code": "InvalidPayload", "compatible": false }
  }
  if !(profile_field(config, "schema") is Number(1, ..)) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE_SCHEMA", "schema", requested)
  }
  let profiles = profile_field(config, "profiles")
  guard profiles is Object(profiles_fields) else {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE_SCHEMA", "profiles", requested)
  }
  let profile = match profiles_fields.get(requested) {
    Some(value) => value
    None => return profile_rejected("ELECTRON_MBT_UNKNOWN_PROFILE", "profile", requested)
  }
  if !(profile is Object(_)) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "profile", requested)
  }
  if !(profile_field(profile, "compatible") is False) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "compatible", requested)
  }
  let engine = profile_text(profile, "engine")
  if !profile_known_engine(engine) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "engine", requested)
  }
  let profile_runtime = profile_text(profile, "runtime")
  if !profile_known_runtime(profile_runtime) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "runtime", requested)
  }
  let implementation = profile_text(profile, "implementation")
  if !profile_known_implementation(implementation) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "implementation", requested)
  }
  let verification = profile_text(profile, "verification")
  if !profile_known_verification(verification) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "verification", requested)
  }
  let gate = profile_text(profile, "gate")
  if !profile_known_gate(gate) {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "gate", requested)
  }
  let input_modes = profile_texts(profile_field(profile, "inputMode"))
  let preload_modes = profile_texts(profile_field(profile, "preloadMode"))
  let scope = profile_texts(profile_field(profile, "scope"))
  if input_modes.length() == 0 || preload_modes.length() == 0 || scope.length() == 0 {
    return profile_rejected("ELECTRON_MBT_INVALID_PROFILE", "modes", requested)
  }
  if gate == "satisfied" && verification != "passed" {
    return profile_rejected("ELECTRON_MBT_PROFILE_INCONSISTENT", "gate", requested)
  }
  if gate == "blocked" && profile_text(profile, "blockedReason").length() == 0 {
    return profile_rejected("ELECTRON_MBT_PROFILE_INCONSISTENT", "blockedReason", requested)
  }
  if input_mode.length() > 0 && !profile_contains(input_modes, input_mode) {
    return {
      "ok": false,
      "code": "ELECTRON_MBT_PROFILE_MISMATCH",
      "field": "inputMode",
      "profile": requested,
      "value": input_mode,
      "compatible": false,
    }
  }
  if preload_mode.length() > 0 && !profile_contains(preload_modes, preload_mode) {
    return {
      "ok": false,
      "code": "ELECTRON_MBT_PROFILE_MISMATCH",
      "field": "preloadMode",
      "profile": requested,
      "value": preload_mode,
      "compatible": false,
    }
  }
  if runtime.length() > 0 && runtime != profile_runtime {
    return {
      "ok": false,
      "code": "ELECTRON_MBT_PROFILE_MISMATCH",
      "field": "runtime",
      "profile": requested,
      "value": runtime,
      "compatible": false,
    }
  }
  let diagnostics : Array[Json] = []
  if gate == "blocked" {
    diagnostics.push("ELECTRON_MBT_PROFILE_BLOCKED".to_json())
  }
  if verification != "passed" {
    diagnostics.push("ELECTRON_MBT_VERIFICATION_INCOMPLETE".to_json())
  }
  if implementation != "implemented" {
    diagnostics.push("ELECTRON_MBT_IMPLEMENTATION_INCOMPLETE".to_json())
  }
  {
    "ok": true,
    "profile": requested,
    "engine": engine,
    "runtime": profile_runtime,
    "implementation": implementation,
    "verification": verification,
    "gate": gate,
    "inputMode": input_modes.to_json(),
    "preloadMode": preload_modes.to_json(),
    "scope": scope.to_json(),
    "diagnostics": diagnostics.to_json(),
    "compatible": false,
  }
}
