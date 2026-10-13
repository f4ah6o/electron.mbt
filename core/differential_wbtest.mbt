///|
fn field(value : Json, key : String) -> Json {
  match value {
    Object(fields) => fields.get(key).unwrap_or(null)
    _ => null
  }
}

///|
test "identical observations are equivalent without claiming compatibility" {
  let observed : Json = {
    "status": "completed",
    "moduleIdentity": true,
    "trace": [["isReady-before", false], ["ready", true]],
    "observation": { "syncValue": 42, "callbackValues": ["first", "second"] },
    "versions": { "electron": "44.7.0", "node": "24.21.0" },
    "platform": "darwin",
    "arch": "arm64",
  }
  let verdict = compare_observations(observed, observed)
  assert_true(field(verdict, "ok") is True)
  assert_true(field(verdict, "verdict") is String("equivalent"))
  assert_true(field(verdict, "compatible") is False)
}

///|
test "environment fields are recorded but never compared" {
  let electron : Json = {
    "status": "aborted",
    "versions": { "electron": "44.7.0", "chromium": "152.0.0.0" },
    "platform": "darwin",
    "arch": "arm64",
  }
  let mbt : Json = {
    "status": "aborted",
    "versions": { "node": "24.21.0" },
    "platform": "linux",
    "arch": "x64",
  }
  let verdict = compare_observations(electron, mbt)
  assert_true(field(verdict, "verdict") is String("equivalent"))
  let env = field(verdict, "environment")
  assert_true(field(field(env, "electron"), "platform") is String("darwin"))
  assert_true(field(field(env, "mbt"), "platform") is String("linux"))
}

///|
test "the first diverging trace entry is reported with its index" {
  let electron : Json = {
    "status": "completed",
    "trace": [["a"], ["b"], ["c"]],
  }
  let mbt : Json = { "status": "completed", "trace": [["a"], ["x"]] }
  let verdict = compare_observations(electron, mbt)
  assert_true(field(verdict, "verdict") is String("diverged"))
  let trace = field(field(verdict, "fields"), "trace")
  assert_true(field(trace, "match") is False)
  assert_true(field(trace, "matchedPrefix") is Number(1, ..))
  assert_true(field(trace, "electronLength") is Number(3, ..))
  assert_true(field(trace, "mbtLength") is Number(2, ..))
  let divergence = field(trace, "firstDivergence")
  assert_true(field(divergence, "index") is Number(1, ..))
  assert_true(field(divergence, "electron") is Array([String("b")]))
  assert_true(field(divergence, "mbt") is Array([String("x")]))
}

///|
test "an early-ended trace diverges at the missing entry" {
  let electron : Json = { "trace": [["a"], ["b"]] }
  let mbt : Json = { "trace": [["a"]] }
  let trace = field(
    field(compare_observations(electron, mbt), "fields"),
    "trace",
  )
  assert_true(field(trace, "matchedPrefix") is Number(1, ..))
  assert_true(field(field(trace, "firstDivergence"), "mbt") is Null)
}

///|
test "a key present on only one side is a reported mismatch" {
  let electron : Json = { "status": "completed" }
  let mbt : Json = {
    "status": "aborted",
    "abort": { "code": "ELECTRON_MBT_UNSUPPORTED_API" },
  }
  let verdict = compare_observations(electron, mbt)
  assert_true(field(verdict, "verdict") is String("diverged"))
  let abort = field(field(verdict, "fields"), "abort")
  assert_true(field(abort, "match") is False)
  assert_true(field(abort, "electron") is String("<absent>"))
  assert_true(
    field(field(abort, "mbt"), "code") is String("ELECTRON_MBT_UNSUPPORTED_API"),
  )
}

///|
test "an explicit null is not equal to an absent key" {
  let electron : Json = { "status": "completed", "extra": null }
  let mbt : Json = { "status": "completed" }
  let verdict = compare_observations(electron, mbt)
  assert_true(field(verdict, "verdict") is String("diverged"))
  let extra = field(field(verdict, "fields"), "extra")
  assert_true(field(extra, "match") is False)
  assert_true(field(extra, "electron") is Null)
  assert_true(field(extra, "mbt") is String("<absent>"))
}

///|
test "non-object observations are rejected as invalid payloads" {
  let array = @json.parse("[1,2,3]")
  assert_true(field(compare_observations(array, { "a": 1 }), "ok") is False)
  assert_true(
    field(compare_observations(array, { "a": 1 }), "code")
    is String("InvalidPayload"),
  )
  assert_true(field(compare_observations({ "a": 1 }, array), "ok") is False)
}
