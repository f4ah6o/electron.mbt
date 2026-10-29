///|
test "asset scheme names are lowercase RFC 3986 custom schemes" {
  assert_true(protocol_scheme_error("moji-asset") is None)
  assert_true(protocol_scheme_error("asset.test+1") is None)
  assert_true(protocol_scheme_error("ab") is Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
  assert_true(protocol_scheme_error("Moji-asset") is Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
  assert_true(protocol_scheme_error("1asset") is Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
  assert_true(protocol_scheme_error("asset_test") is Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
  assert_true(protocol_scheme_error("https") is Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
  assert_true(protocol_scheme_error("file") is Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
  assert_true(protocol_scheme_error("electron-mbt-app") is Some("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
}

///|
test "asset scheme admission rejects duplicates and excess entries" {
  assert_true(admit_asset_schemes(["moji-asset"]) is Ok(_))
  assert_true(admit_asset_schemes([]) is Ok(_))
  assert_true(admit_asset_schemes(["moji-asset", "moji-asset"]) is Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"))
  assert_true(
    admit_asset_schemes(["one-asset", "two-asset", "three-asset", "four-asset", "five-asset"]) is
    Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"),
  )
}

///|
test "privileges are limited to the broker's supported subset" {
  assert_true(
    protocol_privilege_error({
      "standard": true,
      "secure": true,
      "supportFetchAPI": true,
      "corsEnabled": true,
    }) is None,
  )
  assert_true(protocol_privilege_error(null) is None)
  assert_true(
    protocol_privilege_error({ "bypassCSP": true }) is
    Some("ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE"),
  )
  assert_true(
    protocol_privilege_error({ "allowServiceWorkers": true }) is
    Some("ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE"),
  )
  assert_true(
    protocol_privilege_error({ "standard": false }) is
    Some("ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE"),
  )
  assert_true(
    protocol_privilege_error({ "standard": 1 }) is
    Some("ELECTRON_MBT_UNSUPPORTED_PROTOCOL_PRIVILEGE"),
  )
}

///|
test "asset content types use a fixed image allowlist" {
  assert_true(protocol_asset_extension_allowed("/tmp/a.PNG"))
  assert_true(protocol_asset_extension_allowed("/tmp/a.jpeg"))
  assert_true(protocol_asset_extension_allowed("/tmp/a.svg"))
  assert_true(!protocol_asset_extension_allowed("/tmp/a.html"))
  assert_true(!protocol_asset_extension_allowed("/tmp/a"))
  assert_true(protocol_asset_content_type("/tmp/a.png") == "image/png")
  assert_true(protocol_asset_content_type("/tmp/a.JPG") == "image/jpeg")
  assert_true(protocol_asset_content_type("/tmp/a.svg") == "image/svg+xml")
}

///|
test "lexical containment rejects siblings and parent segments" {
  assert_true(protocol_path_within("/tmp/docs/a.png", "/tmp/docs"))
  assert_true(protocol_path_within("/tmp/docs", "/tmp/docs"))
  assert_true(!protocol_path_within("/tmp/docs-evil/a.png", "/tmp/docs"))
  assert_true(!protocol_path_within("/tmp/a.png", "/tmp/docs"))
  assert_true(protocol_path_within("/a.png", "/"))
  assert_true(protocol_path_error("/tmp/docs/a.png") is None)
  assert_true(protocol_path_error("tmp/docs/a.png") is Some("ELECTRON_MBT_PROTOCOL_INVALID_PATH"))
  assert_true(protocol_path_error("/tmp/../etc/passwd") is Some("ELECTRON_MBT_PROTOCOL_INVALID_PATH"))
  assert_true(protocol_path_error("/tmp/a\u{0}.png") is Some("ELECTRON_MBT_PROTOCOL_INVALID_PATH"))
}

///|
test "manifest asset schemes accept absent and valid arrays only" {
  assert_true(protocol_manifest_asset_schemes(null) is Ok(_))
  match protocol_manifest_asset_schemes(["moji-asset", "other-asset"]) {
    Ok(schemes) => assert_true(schemes.length() == 2)
    Err(_) => assert_true(false)
  }
  assert_true(
    protocol_manifest_asset_schemes(["moji-asset", "moji-asset"]) is
    Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"),
  )
  assert_true(
    protocol_manifest_asset_schemes([1]) is
    Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"),
  )
  assert_true(
    protocol_manifest_asset_schemes("moji-asset") is
    Err("ELECTRON_MBT_PROTOCOL_INVALID_SCHEME"),
  )
}
