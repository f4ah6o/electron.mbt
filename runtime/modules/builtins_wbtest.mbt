///|
test "planned Node builtins are separated from unsupported builtins" {
  for name in ["path", "node:path", "url", "node:url", "fs", "node:fs", "fs/promises", "node:fs/promises", "buffer", "events", "process", "zlib", "crypto", "v8", "worker_threads", "perf_hooks", "os"] {
    assert_eq(builtin_status(name), Some(Planned))
  }
  for name in ["child_process", "node:child_process", "vm", "net", "tls", "http", "https", "stream", "util"] {
    assert_eq(builtin_status(name), Some(Unsupported))
  }
  assert_eq(builtin_status("electron"), None)
  assert_eq(builtin_status("node:unknown"), Some(Unsupported))
  assert_true(is_builtin("node:fs"))
  assert_false(is_builtin("electron"))
}

///|
test "planned symbol manifests are explicit and unsupported builtins expose none" {
  assert_true(builtin_symbols("node:path").contains("join"))
  assert_true(builtin_symbols("fs").contains("readFileSync"))
  assert_true(builtin_symbols("fs").contains("statSync"))
  assert_true(builtin_symbols("fs").contains("readdirSync"))
  assert_true(builtin_symbols("fs").contains("mkdirSync"))
  assert_true(builtin_symbols("node:fs/promises").contains("stat"))
  assert_true(builtin_symbols("node:fs/promises").contains("readdir"))
  assert_true(builtin_symbols("node:fs/promises").contains("mkdir"))
  assert_true(builtin_symbols("node:zlib").contains("createDeflate"))
  assert_true(builtin_symbols("node:crypto").contains("createHash"))
  assert_true(builtin_symbols("node:crypto").contains("randomUUID"))
  assert_true(builtin_symbols("node:v8").contains("getHeapStatistics"))
  assert_true(builtin_symbols("node:worker_threads").contains("Worker"))
  assert_true(builtin_symbols("node:perf_hooks").contains("performance"))
  assert_true(builtin_symbols("node:os").contains("platform"))
  assert_eq(builtin_symbols("node:child_process"), [])
  assert_eq(builtin_symbols("electron"), [])
}
