///|
test "scanner matches require, from and import forms" {
  let text = "'use strict';\n" +
    "const a = require('electron');\n" +
    "const b = require(\"node:fs\");\n" +
    "const c = require('./local.js');\n" +
    "const d = require(`computed`);\n" +
    "import x from 'pkg';\n" +
    "import('dynamic');\n" +
    "import 'side-effect';\n" +
    "// require('comment') and from 'comment'\n"
  let result = scan_symbols([
    { path: "out/main/index.js", bytes: text.length(), text: Some(text) },
    { path: "package.json", bytes: 100, text: None },
  ]).unwrap()
  assert_eq(result.scanned_files, 1)
  assert_eq(result.scanned_bytes, text.length())
  assert_eq(result.builtins, ["node:fs"])
  assert_eq(result.packages, ["comment", "dynamic", "electron", "pkg", "side-effect"])
  assert_eq(result.local_imports, ["./local.js"])
  assert_eq(result.completeness, "static-source-only")
}

///|
test "scanner enforces the large-file and total-byte bounds" {
  let text = "require('a');"
  let result = scan_symbols([
    { path: "a.ts", bytes: 1048577, text: None },
    { path: "b.ts", bytes: 1048576, text: Some(text) },
    { path: "c.ts", bytes: 1048576, text: Some(text) },
    { path: "d.ts", bytes: 1048576, text: Some(text) },
    { path: "e.ts", bytes: 1048576, text: Some(text) },
    { path: "f.ts", bytes: 10, text: Some("require('never')") },
  ]).unwrap()
  assert_eq(result.skipped_large_files, 1)
  assert_eq(result.scanned_files, 6)
  assert_eq(result.scanned_bytes, 4 * 1048576)
  assert_eq(result.packages, ["a"])
}

///|
test "scan read indices skip large and post-cut files" {
  let indices = scan_read_indices([
    ("a.js", 1048577),
    ("b.txt", 10),
    ("c.js", 1048576),
    ("d.js", 1048576),
    ("e.js", 1048576),
    ("f.js", 1048576),
  ])
  assert_eq(indices, [2, 3, 4, 5])
}

///|
test "preload detection uses the regex boundary" {
  assert_true(references_preload("mainWindow.webPreferences = { preload: 'x.js' }"))
  assert_true(references_preload("preload : 'x.js'"))
  assert_false(references_preload("my_preload: 'x.js'"))
  assert_true(references_preload("$preload: 'x.js'"))
  assert_false(references_preload("preload = 'x.js'"))
}
