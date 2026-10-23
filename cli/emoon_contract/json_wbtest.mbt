///|
test "ordered json compact and pretty output" {
  let value = CliJson::object([
    ("schema", CliJson::int(2)),
    ("name", CliJson::string("a\"b\\c\n")),
    ("files", CliJson::array([
      CliJson::object([("path", CliJson::string("out/renderer/index.html"))]),
    ])),
    ("empty", CliJson::array([])),
    ("nothing", CliJson::object([])),
    ("ok", CliJson::bool(true)),
    ("nil", CliJson::null()),
  ])
  assert_eq(
    value.to_compact(),
    "{\"schema\":2,\"name\":\"a\\\"b\\\\c\\n\",\"files\":[{\"path\":\"out/renderer/index.html\"}],\"empty\":[],\"nothing\":{},\"ok\":true,\"nil\":null}",
  )
  assert_eq(
    value.to_pretty(),
    "{\n  \"schema\": 2,\n  \"name\": \"a\\\"b\\\\c\\n\",\n  \"files\": [\n    {\n      \"path\": \"out/renderer/index.html\"\n    }\n  ],\n  \"empty\": [],\n  \"nothing\": {},\n  \"ok\": true,\n  \"nil\": null\n}",
  )
  assert_eq(value.to_file_text(), value.to_pretty() + "\n")
}

///|
test "ordered json keeps unicode and escapes control characters" {
  assert_eq(CliJson::string("あ🤣").to_compact(), "\"あ🤣\"")
  assert_eq(CliJson::string("\u{1}\t").to_compact(), "\"\\u0001\\t\"")
  assert_eq(CliJson::string("ok").to_pretty(), "\"ok\"")
}
