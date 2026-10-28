///|
test "bundle slug sanitizes scoped and noisy names" {
  assert_eq(bundle_slug("moji"), "moji")
  assert_eq(bundle_slug("@scope/app"), "scope-app")
  assert_eq(bundle_slug("My  App!!"), "my-app")
  assert_eq(bundle_slug(""), "app")
  assert_eq(bundle_slug(".."), "app")
  assert_eq(bundle_slug("../etc/passwd"), "etc-passwd")
  assert_eq(bundle_slug("あ app"), "app")
}

///|
test "bundle slug is bounded and has no trailing separator" {
  let long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  let slug = bundle_slug(long)
  assert_eq(slug.length(), 48)
  assert_eq(bundle_slug("trailing---"), "trailing")
  assert_eq(bundle_slug("--leading"), "leading")
}

///|
test "bundle file name combines identity and host" {
  assert_eq(
    bundle_file_name("moji", "1.0.7", "linux", "x64"),
    "moji-1.0.7-linux-x64",
  )
  assert_eq(
    bundle_file_name("@scope/app", "2.0.0-beta.1", "linux", "arm64"),
    "scope-app-2.0.0-beta.1-linux-arm64",
  )
  assert_eq(
    bundle_file_name("App", "1.0.0+build", "linux", "x64"),
    "app-1.0.0-build-linux-x64",
  )
  assert_eq(bundle_file_name("", "", "", ""), "app-0.0.0-unknown-unknown")
}

///|
test "bundle size text is stable for reports" {
  assert_eq(bundle_size_text(0), "0 B")
  assert_eq(bundle_size_text(512), "512 B")
  assert_eq(bundle_size_text(2048), "2 KiB")
  assert_eq(bundle_size_text(1048576), "1.0 MiB")
  assert_eq(bundle_size_text(6185192), "5.9 MiB")
}
