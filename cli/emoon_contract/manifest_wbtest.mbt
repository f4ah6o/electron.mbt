///|
test "manifest order puts the page entry first" {
  let ordered = manifest_order("out/renderer/index.html", [
    "package.json", "out/main/index.js", "out/renderer/index.html", "out/renderer/app.js",
  ]).unwrap()
  assert_eq(ordered, [
    "out/renderer/index.html", "package.json", "out/main/index.js", "out/renderer/app.js",
  ])
  assert_eq(manifest_order("entry", []) is Err(_), true)
  assert_eq(manifest_order("entry", ["entry", "entry"]) is Err(_), true)
  assert_eq(manifest_order("entry", ["other"]) is Err(_), true)
}

///|
test "manifest text matches Node pretty output" {
  let text = manifest_text("demo", "out/renderer/index.html", [
    { path: "out/renderer/index.html", sha256: "00", bytes: 10 },
    { path: "out/main/index.js", sha256: "11", bytes: 20 },
  ]).unwrap()
  assert_eq(
    text,
    "{\n  \"schema\": 2,\n  \"app\": \"demo\",\n  \"entry\": \"out/renderer/index.html\",\n  \"files\": [\n    {\n      \"path\": \"out/renderer/index.html\",\n      \"sha256\": \"00\",\n      \"bytes\": 10\n    },\n    {\n      \"path\": \"out/main/index.js\",\n      \"sha256\": \"11\",\n      \"bytes\": 20\n    }\n  ]\n}\n",
  )
}
