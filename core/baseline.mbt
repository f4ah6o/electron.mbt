///|
fn baseline_rejected(field : String) -> Json {
  {
    "ok": false,
    "code": "ELECTRON_MBT_INVALID_BASELINE",
    "field": field,
    "compatible": false,
  }
}

///|
fn baseline_value(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
fn baseline_nonempty_text(value : Json) -> Bool {
  match value {
    String(text) => text.length() > 0
    _ => false
  }
}

///|
// The comparator intentionally permits arbitrary observations. Reusing it as
// baseline admission would let two aborted runs masquerade as a reference.
pub fn validate_baseline(
  report : Json,
  electron_version : String,
  node_version : String,
  fixture_hash : String,
) -> Json {
  if electron_version.length() == 0 ||
    node_version.length() == 0 ||
    fixture_hash.length() != 64 {
    return { "ok": false, "code": "InvalidPayload", "compatible": false }
  }
  if !(report is Object(_)) {
    return baseline_rejected("report")
  }
  if !(baseline_value(report, "schema") is Number(1, ..)) {
    return baseline_rejected("schema")
  }
  if !(baseline_value(report, "status") is String("baseline-collected")) {
    return baseline_rejected("status")
  }
  if !(baseline_value(report, "compatible") is False) {
    return baseline_rejected("compatible")
  }
  if !json_equal(baseline_value(report, "fixtureHash"), Json(fixture_hash), 0) {
    return baseline_rejected("fixtureHash")
  }
  let observed = baseline_value(report, "observed")
  guard observed is Object(fields) else {
    return baseline_rejected("observed")
  }
  if !(baseline_value(observed, "status") is String("completed")) {
    return baseline_rejected("observed.status")
  }
  if fields.get("abort") is Some(_) {
    return baseline_rejected("observed.abort")
  }
  let versions = baseline_value(observed, "versions")
  if !json_equal(baseline_value(versions, "electron"), Json(electron_version), 0) {
    return baseline_rejected("observed.versions.electron")
  }
  if !json_equal(baseline_value(versions, "node"), Json(node_version), 0) {
    return baseline_rejected("observed.versions.node")
  }
  for key in ["platform", "arch"] {
    if !baseline_nonempty_text(baseline_value(observed, key)) {
      return baseline_rejected("observed." + key)
    }
  }
  // A false measurement is useful evidence, not a reason to reject a run.
  // Only shape/completion/provenance are admission conditions here.
  match baseline_value(observed, "moduleIdentity") {
    True | False => ()
    _ => return baseline_rejected("observed.moduleIdentity")
  }
  // An empty trace or measurement payload is shape-valid but carries no
  // semantic observation. Admitting it would let a vacuous baseline certify a
  // later comparison, so require at least one recorded entry in each.
  let trace = baseline_value(observed, "trace")
  guard trace is Array(trace_entries) && trace_entries.length() > 0 else {
    return baseline_rejected("observed.trace")
  }
  let measurement = baseline_value(observed, "observation")
  guard measurement is Object(measurement_fields) && measurement_fields.length() > 0 else {
    return baseline_rejected("observed.observation")
  }
  { "ok": true, "compatible": false }
}
