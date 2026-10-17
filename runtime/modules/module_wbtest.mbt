///|
fn module_registry_fixture() -> ModuleRegistry raise {
  let registry = ModuleRegistry::new(8)
  let deps_a : Map[String, String] = { "b": "b" }
  let deps_b : Map[String, String] = { "a": "a" }
  match registry.register("a", "sha256:a", CommonJs, deps_a) {
    Ok(_) => ()
    Err(_) => assert_true(false)
  }
  match registry.register("b", "sha256:b", CommonJs, deps_b) {
    Ok(_) => ()
    Err(_) => assert_true(false)
  }
  registry
}

///|
test "modules load once and cycles resolve while both records are loading" {
  let registry = module_registry_fixture()
  assert_eq(registry.state("a"), Ok(Loading))
  assert_eq(registry.resolve("a", "b"), Ok("b"))
  assert_eq(registry.resolve("b", "a"), Ok("a"))
  assert_eq(registry.finish("b"), Ok(()))
  assert_eq(registry.finish("a"), Ok(()))
  assert_eq(registry.loaded_count(), 2)
  assert_eq(registry.order(), ["a", "b"])
}

///|
test "duplicate, unknown and missing-dependency admissions are typed" {
  let registry = ModuleRegistry::new(2)
  assert_eq(registry.register("a", "sha256:a", CommonJs, {}), Ok(()))
  assert_eq(registry.register("a", "sha256:b", CommonJs, {}), Err(DuplicateModule))
  assert_eq(registry.state("missing"), Err(UnknownModule))
  assert_eq(registry.resolve("a", "./missing"), Err(DependencyMissing))
  assert_eq(registry.register("b", "sha256:b", CommonJs, {}), Ok(()))
  assert_eq(registry.register("c", "sha256:c", CommonJs, {}), Err(LimitExceeded))
}

///|
test "invalid records and terminal transitions fail closed" {
  let registry = ModuleRegistry::new(2)
  assert_eq(registry.register("", "sha256:a", CommonJs, {}), Err(InvalidModule))
  assert_eq(registry.register("a", "", CommonJs, {}), Err(InvalidModule))
  assert_eq(registry.register("a", "sha256:a", Unsupported, {}), Ok(()))
  assert_eq(registry.finish("a"), Ok(()))
  assert_eq(registry.finish("a"), Err(InvalidState))
  assert_eq(registry.fail("a"), Err(InvalidState))
}
