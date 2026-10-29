///|
test "config text matches Node pretty output" {
  let config = CliConfig::{
    schema: 1,
    main: "out/main/index.js",
    renderer: "out/renderer",
    page: "out/renderer/index.html",
    include: ["src/unused.js"],
    api: None,
    asset_schemes: [],
    config_file: ".emoon/config.json",
    workspace: ".emoon",
  }
  assert_eq(
    config_text(config),
    "{\n  \"schema\": 1,\n  \"main\": \"out/main/index.js\",\n  \"renderer\": \"out/renderer\",\n  \"page\": \"out/renderer/index.html\",\n  \"include\": [\n    \"src/unused.js\"\n  ],\n  \"api\": null\n}\n",
  )
}

///|
test "config parsing and CLI merge" {
  let parsed = @json.parse(
    "{\"schema\":1,\"main\":\"out/main/index.js\",\"renderer\":\"out/renderer\",\"page\":\"out/renderer/index.html\",\"include\":[\"a\",\"b\"],\"api\":null}",
  )
  let config = config_from_json(parsed, "/app/.emoon/config.json", "/app/.emoon").unwrap()
  assert_eq(config.main, "out/main/index.js")
  assert_eq(config.api, None)
  let args = parse_args([
    "--renderer", "dist/renderer", "--page", "dist/renderer/app.html",
    "--include", "b,c", "--api", "",
  ]).unwrap()
  let merged = merge_config(config, args).unwrap()
  assert_eq(merged.renderer, "dist/renderer")
  assert_eq(merged.page, "dist/renderer/app.html")
  assert_eq(merged.include, ["a", "b", "c"])
  assert_eq(merged.api, None)
}

///|
test "config rejects unsupported shapes" {
  assert_eq(config_from_json(@json.parse("{\"schema\":2}"), "c", "w") is Err(_), true)
  assert_eq(config_from_json(@json.parse("{\"schema\":1,\"main\":\"/x\",\"renderer\":\"r\"}"), "c", "w") is Err(_), true)
  assert_eq(config_from_json(@json.parse("{\"schema\":1,\"main\":\"m\"}"), "c", "w") is Err(_), true)
  assert_eq(config_from_json(@json.parse("{\"schema\":1,\"main\":\"m\",\"renderer\":\"r\",\"api\":7}"), "c", "w") is Err(_), true)
}

///|
test "asset scheme config round-trips and CLI merge validates" {
  let parsed = @json.parse(
    "{\"schema\":1,\"main\":\"m\",\"renderer\":\"r\",\"assetSchemes\":[\"moji-asset\"]}",
  )
  let config = config_from_json(parsed, "/app/.emoon/config.json", "/app/.emoon").unwrap()
  assert_eq(config.asset_schemes, ["moji-asset"])
  assert_true(config_text(config).contains("\"assetSchemes\""))
  let args = parse_args(["--asset-scheme", "one-asset,two-asset"]).unwrap()
  let merged = merge_config(config, args).unwrap()
  assert_eq(merged.asset_schemes, ["one-asset", "two-asset"])
  let cleared = merge_config(config, parse_args(["--asset-scheme", ""]).unwrap()).unwrap()
  assert_eq(cleared.asset_schemes, [])
  assert_true(config_from_json(
    @json.parse("{\"schema\":1,\"main\":\"m\",\"renderer\":\"r\",\"assetSchemes\":[\"Bad\"]}"),
    "c", "w",
  ) is Err(_))
}
