///|
// Differential comparison of one unchanged fixture's observations on the
// reference Electron runtime and on electron.mbt. Environment fields
// (versions, platform, arch) are recorded for evidence but never compared;
// each runtime emits them from its own process and they legitimately differ.
// An "equivalent" verdict on a single fixture is not a compatibility claim.

///|
let environment_keys : Array[String] = ["versions", "platform", "arch"]

///|
// Bound divergence evidence so a hostile or buggy observation cannot grow the
// report without limit.
const REPORT_FIELD_LIMIT : Int = 256

///|
fn json_equal(left : Json, right : Json, depth : Int) -> Bool {
  // Beyond the manifest JSON depth the observation is out of profile, so a
  // deeper pair cannot be reported equal.
  if depth > 64 {
    return false
  }
  match (left, right) {
    (Null, Null) => true
    (True, True) => true
    (False, False) => true
    (Number(a, ..), Number(b, ..)) => a == b
    (String(a), String(b)) => a == b
    (Array(a), Array(b)) => {
      if a.length() != b.length() {
        return false
      }
      for i in 0..<a.length() {
        if !json_equal(a[i], b[i], depth + 1) {
          return false
        }
      }
      true
    }
    (Object(a), Object(b)) => {
      if a.length() != b.length() {
        return false
      }
      for key, value in a {
        match b.get(key) {
          Some(other) =>
            if !json_equal(value, other, depth + 1) {
              return false
            }
          None => return false
        }
      }
      true
    }
    _ => false
  }
}

///|
fn bounded(value : Json) -> Json {
  let raw = value.stringify()
  if raw.length() > REPORT_FIELD_LIMIT {
    Json(raw[:REPORT_FIELD_LIMIT].to_owned() + "…")
  } else {
    value
  }
}

///|
// An absent key reports a marker rather than null so an explicit JSON null on
// one side stays distinct from a missing field.
fn bounded_option(value : Option[Json]) -> Json {
  match value {
    Some(inner) => bounded(inner)
    None => Json("<absent>")
  }
}

///|
fn trace_verdict(electron : Json, mbt : Json) -> Json {
  match (electron, mbt) {
    (Array(left), Array(right)) => {
      let bound = if left.length() < right.length() {
        left.length()
      } else {
        right.length()
      }
      let mut prefix = 0
      while prefix < bound && json_equal(left[prefix], right[prefix], 0) {
        prefix += 1
      }
      let matched = prefix == left.length() && prefix == right.length()
      let divergence : Json = if matched {
        null
      } else {
        {
          "index": prefix,
          "electron": if prefix < left.length() {
            bounded(left[prefix])
          } else {
            null
          },
          "mbt": if prefix < right.length() { bounded(right[prefix]) } else { null },
        }
      }
      {
        "match": matched,
        "matchedPrefix": prefix,
        "electronLength": left.length(),
        "mbtLength": right.length(),
        "firstDivergence": divergence,
      }
    }
    _ => {
      let matched = json_equal(electron, mbt, 0)
      {
        "match": matched,
        "matchedPrefix": 0,
        "electronLength": null,
        "mbtLength": null,
        "firstDivergence": if matched {
          null
        } else {
          { "index": 0, "electron": bounded(electron), "mbt": bounded(mbt) }
        },
      }
    }
  }
}

///|
fn field_verdict(electron : Json, mbt : Json) -> Json {
  {
    "match": json_equal(electron, mbt, 0),
    "electron": bounded(electron),
    "mbt": bounded(mbt),
  }
}

///|
fn environment(fields : Map[String, Json]) -> Json {
  let env : Map[String, Json] = Map([])
  for key in environment_keys {
    match fields.get(key) {
      Some(value) => env[key] = value
      None => ()
    }
  }
  Json(env)
}

///|
fn matched(verdict : Json) -> Bool {
  match verdict {
    Object(fields) => fields.get("match") is Some(True)
    _ => false
  }
}

///|
// Compare two raw observation objects key by key. Present-on-one-side keys are
// reported as mismatches; the trace field additionally records the longest
// matching prefix and the first diverging entry so a report states exactly
// where the runs stopped agreeing.
pub fn compare_observations(electron : Json, mbt : Json) -> Json {
  guard electron is Object(electron_fields) && mbt is Object(mbt_fields) else {
    return { "ok": false, "code": "InvalidPayload" }
  }
  let keys : Array[String] = []
  for key, _ in electron_fields {
    if !environment_keys.contains(key) && !keys.contains(key) {
      keys.push(key)
    }
  }
  for key, _ in mbt_fields {
    if !environment_keys.contains(key) && !keys.contains(key) {
      keys.push(key)
    }
  }
  keys.sort()
  let fields : Map[String, Json] = Map([])
  let mut equivalent = true
  for key in keys {
    let left = electron_fields.get(key)
    let right = mbt_fields.get(key)
    let verdict = match (left, right) {
      (Some(electron_value), Some(mbt_value)) =>
        if key == "trace" {
          trace_verdict(electron_value, mbt_value)
        } else {
          field_verdict(electron_value, mbt_value)
        }
      _ =>
        {
          "match": false,
          "electron": bounded_option(left),
          "mbt": bounded_option(right),
        }
    }
    if !matched(verdict) {
      equivalent = false
    }
    fields[key] = verdict
  }
  {
    "ok": true,
    "verdict": if equivalent { "equivalent" } else { "diverged" },
    // One unchanged fixture can only ever be evidence for a gap, never proof
    // of compatibility.
    "compatible": false,
    "fields": Json(fields),
    "environment": {
      "electron": environment(electron_fields),
      "mbt": environment(mbt_fields),
    },
    "note": "Differential of one unchanged fixture. Environment fields are recorded, not compared.",
  }
}
