///|
fn resolve_fixture() -> FileIndex raise {
  let index = FileIndex::new()
  let _ = index.add_file("out/main/main.js")
  let _ = index.add_file("out/main/dep.js")
  let _ = index.add_file("out/main/dir/index.cjs")
  let _ = index.add_file("out/main/dir/data.json")
  let _ = index.add_file("out/main/pkg/entry.cjs")
  let _ = index.add_package_main("out/main/pkg", "entry.cjs")
  let _ = index.add_file("out/main/native.node")
  let _ = index.add_file("out/main/source.ts")
  index
}

///|
test "relative files, extensions, directories and package mains resolve" {
  let index = resolve_fixture()
  assert_eq(index.resolve("out/main", "./dep"), Ok("out/main/dep.js"))
  assert_eq(index.resolve("out/main", "./dep.js"), Ok("out/main/dep.js"))
  assert_eq(index.resolve("out/main", "./dir"), Ok("out/main/dir/index.cjs"))
  assert_eq(index.resolve("out/main", "./dir/data"), Ok("out/main/dir/data.json"))
  assert_eq(index.resolve("out/main", "./pkg"), Ok("out/main/pkg/entry.cjs"))
  assert_eq(index.resolve("out", "./main/dep"), Ok("out/main/dep.js"))
}

///|
test "missing, escaping, absolute, package and unsupported specifiers fail closed" {
  let index = resolve_fixture()
  assert_eq(index.resolve("out/main", "./missing"), Err(NotFound))
  assert_eq(index.resolve("out", "../../escape"), Err(EscapesRoot))
  assert_eq(index.resolve("out/main", "/absolute.js"), Err(AbsoluteSpecifier))
  assert_eq(index.resolve("out/main", "electron"), Err(UnsupportedSpecifier))
  assert_eq(index.resolve("out/main", ""), Err(EmptySpecifier))
  assert_eq(index.resolve("out/main", "./native"), Err(UnsupportedExtension))
  assert_eq(index.resolve("out/main", "./source.ts"), Err(UnsupportedExtension))
}

///|
test "file index admission rejects empty, absolute and escaping paths" {
  let index = FileIndex::new()
  assert_eq(index.add_file(""), Err(UnsupportedSpecifier))
  assert_eq(index.add_file("/absolute.js"), Err(UnsupportedSpecifier))
  assert_eq(index.add_file("../escape.js"), Err(EscapesRoot))
  assert_eq(index.add_file("a/./b.js"), Ok(()))
  assert_eq(index.resolve("a", "./b"), Ok("a/b.js"))
  assert_eq(index.add_package_main("pkg", ""), Err(UnsupportedSpecifier))
}
