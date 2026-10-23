///|
test "adapter generation covers all member kinds" {
  let manifest = @json.parse(
    "{\"schema\":3,\"name\":\"demo\",\"version\":\"1.0.0\",\"topics\":[{\"topic\":\"settings\",\"method\":\"onSettings\"}],\"calls\":[{\"name\":\"getSettings\",\"operation\":\"getSettings\",\"args\":\"none\"},{\"name\":\"setSettings\",\"operation\":\"setSettings\",\"args\":\"json\"},{\"name\":\"pair\",\"operation\":\"pair\",\"args\":\"json-list\",\"arity\":2}],\"unsupported\":[{\"name\":\"legacy\",\"code\":\"E_LEGACY\",\"reason\":\"not supported\"}],\"queue\":{\"maxCalls\":4,\"maxBytes\":16384,\"readyTimeoutMs\":5000}}",
  )
  let source = build_adapter(manifest).unwrap()
  assert_true(source.has_prefix("'use strict';\n(function () {\n  const TOPICS = Object.freeze([\"settings\"]);\n"))
  assert_true(source.contains("  const MAX_CALLS = 4;\n  const MAX_BYTES = 16384;\n  const READY_TIMEOUT_MS = 5000;\n"))
  assert_true(source.contains("    version: function () { return \"1.0.0\"; }"))
  assert_true(source.contains("    onSettings: function (callback) { return addListener(\"settings\", callback); }"))
  assert_true(source.contains("    getSettings: function () { return invoke(\"getSettings\", null, false); }"))
  assert_true(source.contains("    setSettings: function (value) { return invoke(\"setSettings\", value, true); }"))
  assert_true(source.contains("    pair: function (arg0, arg1) { return invoke(\"pair\", Array.prototype.slice.call(arguments), true); }"))
  assert_true(source.contains("    legacy: function () { return Promise.reject(adapterError(\"E_LEGACY\", \"not supported\")); }"))
  assert_true(source.has_suffix("})();\n"))
}

///|
test "adapter validation follows the reference messages" {
  let base = "{\"schema\":2,\"name\":\"demo\",\"version\":\"1\",\"topics\":[{\"topic\":\"t\",\"method\":\"onT\"}],\"calls\":[{\"name\":\"get\",\"operation\":\"get\"}],\"queue\":{\"maxCalls\":4,\"maxBytes\":16384,\"readyTimeoutMs\":5000}}"
  assert_eq(build_adapter(@json.parse(base)) is Ok(_), true)
  assert_eq(
    build_adapter(@json.parse("{\"schema\":1}")).unwrap_err(),
    "ELECTRON_MBT_ADAPTED_ADAPTER: expected schema 2 or 3",
  )
  assert_eq(
    build_adapter(@json.parse("{\"schema\":2,\"name\":\"1bad\",\"version\":\"1\",\"topics\":[{\"topic\":\"t\",\"method\":\"m\"}],\"calls\":[{\"name\":\"c\",\"operation\":\"o\"}],\"queue\":{\"maxCalls\":1,\"maxBytes\":1,\"readyTimeoutMs\":1}}")).unwrap_err(),
    "ELECTRON_MBT_ADAPTED_ADAPTER: invalid API name",
  )
  assert_eq(
    build_adapter(@json.parse("{\"schema\":2,\"name\":\"demo\",\"version\":\"1\",\"topics\":[{\"topic\":\"t\",\"method\":\"m\"},{\"topic\":\"t\",\"method\":\"n\"}],\"calls\":[{\"name\":\"c\",\"operation\":\"o\"}],\"queue\":{\"maxCalls\":1,\"maxBytes\":1,\"readyTimeoutMs\":1}}")).unwrap_err(),
    "ELECTRON_MBT_ADAPTED_ADAPTER: duplicate topic",
  )
  assert_eq(
    build_adapter(@json.parse("{\"schema\":2,\"name\":\"demo\",\"version\":\"1\",\"topics\":[{\"topic\":\"t\",\"method\":\"version\"}],\"calls\":[{\"name\":\"c\",\"operation\":\"o\"}],\"queue\":{\"maxCalls\":1,\"maxBytes\":1,\"readyTimeoutMs\":1}}")).unwrap_err(),
    "ELECTRON_MBT_ADAPTED_ADAPTER: reserved API name",
  )
  assert_eq(
    build_adapter(@json.parse("{\"schema\":2,\"name\":\"demo\",\"version\":\"1\",\"topics\":[{\"topic\":\"t\",\"method\":\"m\"}],\"calls\":[{\"name\":\"c\",\"operation\":\"o\",\"args\":\"json-list\",\"arity\":2}],\"queue\":{\"maxCalls\":1,\"maxBytes\":1,\"readyTimeoutMs\":1}}")).unwrap_err(),
    "ELECTRON_MBT_ADAPTED_ADAPTER: json-list requires schema 3",
  )
  assert_eq(
    build_adapter(@json.parse("{\"schema\":3,\"name\":\"demo\",\"version\":\"1\",\"topics\":[{\"topic\":\"t\",\"method\":\"m\"}],\"calls\":[{\"name\":\"c\",\"operation\":\"o\"}],\"queue\":{\"maxCalls\":0,\"maxBytes\":1,\"readyTimeoutMs\":1}}")).unwrap_err(),
    "ELECTRON_MBT_ADAPTED_ADAPTER: invalid queue limits",
  )
}
