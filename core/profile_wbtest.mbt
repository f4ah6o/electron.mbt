///|
fn profile_test_config() -> Json {
  {
    "schema": 1,
    "profiles": {
      "desktop-core-v1": {
        "engine": "node",
        "runtime": "node-backed",
        "implementation": "partial",
        "verification": "not-run",
        "gate": "open",
        "compatible": false,
        "inputMode": ["original-cjs", "prepared-js", "ts-build"],
        "preloadMode": ["original"],
        "scope": ["kernel", "native-probe"],
        "blockedReason": null,
      },
      "electron-nodeless-v1": {
        "engine": "quickjs",
        "runtime": "quickjs-native",
        "implementation": "planned",
        "verification": "not-run",
        "gate": "blocked",
        "compatible": false,
        "inputMode": ["original-cjs"],
        "preloadMode": ["original"],
        "scope": ["kernel", "native-ingress"],
        "blockedReason": "strict bridge remains blocked",
      },
      "electron-nodeless-adapted-v1": {
        "engine": "quickjs",
        "runtime": "quickjs-native",
        "implementation": "planned",
        "verification": "not-run",
        "gate": "open",
        "compatible": false,
        "inputMode": ["original-cjs", "prepared-js", "ts-build"],
        "preloadMode": ["generated-adapter"],
        "scope": ["kernel", "native-ingress", "app-scenario", "release"],
        "blockedReason": null,
      },
      "moonbit-native-v1": {
        "engine": "moonbit",
        "runtime": "moonbit-native",
        "implementation": "planned",
        "verification": "not-run",
        "gate": "open",
        "compatible": false,
        "inputMode": ["moonbit-source"],
        "preloadMode": ["none"],
        "scope": ["app-scenario"],
        "blockedReason": null,
      },
    },
  }
}

///|
fn profile_test_validate(
  config : Json,
  requested : String,
  input_mode : String,
  preload_mode : String,
  runtime : String,
) -> Json {
  validate_profile(config, requested, input_mode, preload_mode, runtime)
}

///|
test "a known open profile is admitted without claiming compatibility" {
  let result = profile_test_validate(
    profile_test_config(), "desktop-core-v1", "", "", "",
  )
  assert_true(profile_field(result, "ok") is True)
  assert_true(profile_field(result, "compatible") is False)
  assert_true(profile_field(result, "gate") is String("open"))
  assert_true(profile_field(result, "profile") is String("desktop-core-v1"))
}

///|
test "unknown profiles and mismatched selections are rejected" {
  let unknown = profile_test_validate(
    profile_test_config(), "unknown-v1", "", "", "",
  )
  assert_true(profile_field(unknown, "ok") is False)
  assert_true(
    profile_field(unknown, "code") is String("ELECTRON_MBT_UNKNOWN_PROFILE"),
  )
  let input = profile_test_validate(
    profile_test_config(), "desktop-core-v1", "esm-main", "", "",
  )
  assert_true(
    profile_field(input, "code") is String("ELECTRON_MBT_PROFILE_MISMATCH"),
  )
  assert_true(profile_field(input, "field") is String("inputMode"))
  let preload = profile_test_validate(
    profile_test_config(), "electron-nodeless-adapted-v1", "original-cjs",
    "original", "",
  )
  assert_true(
    profile_field(preload, "code") is String("ELECTRON_MBT_PROFILE_MISMATCH"),
  )
  assert_true(profile_field(preload, "field") is String("preloadMode"))
  let runtime = profile_test_validate(
    profile_test_config(), "electron-nodeless-adapted-v1", "", "",
    "node-backed",
  )
  assert_true(
    profile_field(runtime, "code") is String("ELECTRON_MBT_PROFILE_MISMATCH"),
  )
  assert_true(profile_field(runtime, "field") is String("runtime"))
}

///|
test "a blocked profile is recognized but stays blocked" {
  let result = profile_test_validate(
    profile_test_config(), "electron-nodeless-v1", "", "", "",
  )
  assert_true(profile_field(result, "ok") is True)
  assert_true(profile_field(result, "gate") is String("blocked"))
  assert_true(profile_field(result, "compatible") is False)
  assert_true(
    profile_field(result, "diagnostics") is Array(diagnostics) &&
    diagnostics.length() > 0,
  )
}

///|
test "a blocked profile needs a reason and satisfied needs passed evidence" {
  let config = profile_test_config()
  match profile_field(config, "profiles") {
    Object(profiles) =>
      match profiles.get("electron-nodeless-v1") {
        Some(profile) =>
          match profile {
            Object(fields) => fields["blockedReason"] = ""
            _ => ()
          }
        None => ()
      }
    _ => ()
  }
  let missing_reason = profile_test_validate(
    config, "electron-nodeless-v1", "", "", "",
  )
  assert_true(
    profile_field(missing_reason, "code") is String(
      "ELECTRON_MBT_PROFILE_INCONSISTENT",
    ),
  )
  let satisfied = profile_test_config()
  match profile_field(satisfied, "profiles") {
    Object(profiles) =>
      match profiles.get("moonbit-native-v1") {
        Some(profile) =>
          match profile {
            Object(fields) => fields["gate"] = "satisfied"
            _ => ()
          }
        None => ()
      }
    _ => ()
  }
  let not_passed = profile_test_validate(
    satisfied, "moonbit-native-v1", "", "", "",
  )
  assert_true(
    profile_field(not_passed, "code") is String(
      "ELECTRON_MBT_PROFILE_INCONSISTENT",
    ),
  )
}

///|
test "a profile cannot claim compatibility or use unknown enums" {
  let config = profile_test_config()
  match profile_field(config, "profiles") {
    Object(profiles) =>
      match profiles.get("moonbit-native-v1") {
        Some(profile) =>
          match profile {
            Object(fields) => {
              fields["compatible"] = true
            }
            _ => ()
          }
        None => ()
      }
    _ => ()
  }
  let compatible = profile_test_validate(
    config, "moonbit-native-v1", "", "", "",
  )
  assert_true(profile_field(compatible, "ok") is False)
  assert_true(profile_field(compatible, "field") is String("compatible"))
  let bad_schema = profile_test_validate({}, "desktop-core-v1", "", "", "")
  assert_true(profile_field(bad_schema, "ok") is False)
  assert_true(profile_field(bad_schema, "field") is String("schema"))
}
