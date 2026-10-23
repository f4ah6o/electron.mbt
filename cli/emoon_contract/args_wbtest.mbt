///|
test "argument parsing follows the reference CLI" {
  let args = parse_args([
    "app", "--renderer", "out/renderer", "--include", "a, b,,c",
    "--api", "", "--force", "--reset-data", "--dry-run", "--no-launch",
    "--json", "--help", "--out", ".emoon/stage",
  ]).unwrap()
  assert_eq(args.app_dir, "app")
  assert_eq(args.value("renderer"), Some("out/renderer"))
  assert_eq(args.value("api"), Some(""))
  assert_eq(args.value("out"), Some(".emoon/stage"))
  assert_eq(args.include, ["a", "b", "c"])
  assert_true(args.has("force"))
  assert_true(args.has("reset-data"))
  assert_true(args.has("dry-run"))
  assert_true(args.has("no-launch"))
  assert_true(args.has("json"))
  assert_true(args.has("help"))
  assert_false(args.has("missing"))
}

///|
test "argument parsing rejects missing values and two positionals" {
  assert_eq(parse_args(["--renderer"]) is Err(_), true)
  assert_eq(parse_args(["--renderer", "--force"]) is Err(_), true)
  assert_eq(parse_args(["a", "b"]) is Err(_), true)
  assert_eq(parse_args(["--app-dir", "one"]).unwrap().app_dir, "one")
  assert_eq(parse_args(["--unknown", "value"]).unwrap().value("unknown"), Some("value"))
}
