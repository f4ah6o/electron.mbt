///|
test "relative path validation and containment" {
  assert_eq(normalize_relative("out/renderer/index.html", "renderer"), Ok("out/renderer/index.html"))
  assert_eq(normalize_relative("/etc/passwd", "renderer") is Err(_), true)
  assert_eq(normalize_relative("../outside", "renderer") is Err(_), true)
  assert_eq(normalize_relative("a\\..\\b", "renderer") is Err(_), true)
  assert_eq(normalize_relative("", "renderer") is Err(_), true)
  assert_eq(path_inside("/app", "/app"), true)
  assert_eq(path_inside("/app", "/app/.emoon/app"), true)
  assert_eq(path_inside("/app", "/application/app"), false)
  assert_eq(path_inside("/", "/etc/passwd"), true)
  assert_eq(path_inside("/app", "/app2"), false)
}

///|
test "path join, dirname, basename" {
  assert_eq(join_path("/app", "out/main.js"), "/app/out/main.js")
  assert_eq(join_path("/app/", "out"), "/app/out")
  assert_eq(join_path("/app", ""), "/app")
  assert_eq(path_dirname("/app/out/main.js"), "/app/out")
  assert_eq(path_dirname("main.js"), ".")
  assert_eq(path_dirname("/x"), "/")
  assert_eq(path_basename("/app/out/main.js"), "main.js")
  assert_eq(path_basename("/app/out/"), "out")
  assert_eq(path_basename("/"), "")
}

///|
test "utf16 sorting matches JavaScript order for supplementary characters" {
  let values = ["\u{10000}", "\u{e000}", "a", "A"]
  sort_utf16(values)
  assert_eq(values[0], "A")
  assert_eq(values[1], "a")
  assert_eq(values[2], "\u{10000}")
  assert_eq(values[3], "\u{e000}")
  assert_eq(utf16_compare("a", "ab"), -1)
  assert_eq(utf16_compare("ab", "a"), 1)
  assert_eq(utf16_compare("a", "a"), 0)
}
