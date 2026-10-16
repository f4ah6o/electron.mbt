///|
fn baseline_test_report() -> Json {
  {
    "schema": 1,
    "status": "baseline-collected",
    "compatible": false,
    "fixtureHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "observed": {
      "status": "completed",
      "moduleIdentity": true,
      "trace": [["ready", true], ["quit"]],
      "observation": { "syncValue": 42 },
      "versions": { "electron": "44.7.0", "node": "24.21.0" },
      "platform": "darwin",
      "arch": "arm64",
    },
  }
}

///|
fn baseline_test_validate(report : Json) -> Json {
  validate_baseline(
    report,
    "44.7.0",
    "24.21.0",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  )
}

///|
fn baseline_test_set(report : Json, key : String, value : Json) -> Unit {
  match report {
    Object(fields) => fields[key] = value
    _ => ()
  }
}

///|
test "a completed pinned baseline is admitted without certifying compatibility" {
  let result = baseline_test_validate(baseline_test_report())
  assert_true(baseline_value(result, "ok") is True)
  assert_true(baseline_value(result, "compatible") is False)
}

///|
test "aborted failed and missing completion cannot become a baseline" {
  let statuses : Array[Json] = ["aborted", "failed", null]
  for status in statuses {
    let report = baseline_test_report()
    baseline_test_set(baseline_value(report, "observed"), "status", status)
    let result = baseline_test_validate(report)
    assert_true(baseline_value(result, "ok") is False)
    assert_true(baseline_value(result, "field") is String("observed.status"))
  }
}

///|
test "reference versions and fixture identity must match the supplied pins" {
  let report = baseline_test_report()
  let wrong_electron = validate_baseline(
    report,
    "0.0.0",
    "24.21.0",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  )
  assert_true(
    baseline_value(wrong_electron, "field") is String("observed.versions.electron"),
  )
  let wrong_node = validate_baseline(
    report,
    "44.7.0",
    "0.0.0",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  )
  assert_true(baseline_value(wrong_node, "field") is String("observed.versions.node"))
  let wrong_fixture = validate_baseline(
    report,
    "44.7.0",
    "24.21.0",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  )
  assert_true(baseline_value(wrong_fixture, "field") is String("fixtureHash"))
}

///|
test "missing null and malformed baseline containers are rejected" {
  let invalid_reports : Array[Json] = [null, [], {}, true]
  for report in invalid_reports {
    assert_true(baseline_value(baseline_test_validate(report), "ok") is False)
  }
  for key in ["compatible", "observed", "fixtureHash", "schema", "status"] {
    let report = baseline_test_report()
    baseline_test_set(report, key, null)
    assert_true(baseline_value(baseline_test_validate(report), "ok") is False)
  }
}

///|
test "a completed baseline cannot carry an abort even when it is null" {
  let report = baseline_test_report()
  baseline_test_set(baseline_value(report, "observed"), "abort", null)
  let result = baseline_test_validate(report)
  assert_true(baseline_value(result, "field") is String("observed.abort"))
}

///|
test "negative measurements remain evidence rather than being forced to pass" {
  let report = baseline_test_report()
  let observed = baseline_value(report, "observed")
  baseline_test_set(observed, "moduleIdentity", false)
  baseline_test_set(observed, "observation", { "syncThrow": false })
  assert_true(baseline_value(baseline_test_validate(report), "ok") is True)
}
