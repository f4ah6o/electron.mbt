///|
test "QJS-01 evaluates primitives, objects and exceptions synchronously" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let number = context.eval_script("1 + 1", "qjs-01.js")
  assert_true(number.status is Value)
  assert_eq(number.text, "2")
  let object = context.eval_script("({ answer: 42 })", "qjs-01-object.js")
  assert_true(object.status is Value)
  assert_eq(object.text, "{\"answer\":42}")
  let failure = context.eval_script("throw new Error('qjs-expected')", "qjs-01-throw.js")
  assert_true(failure.status is Exception)
  assert_true(failure.text.contains("qjs-expected"))
  context.destroy()
  engine.destroy()
}

///|
test "QJS-02 value leases can be duplicated and released independently" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let first = context.eval_raw("({ value: 7 })", "qjs-02.js")
  let second = first.dup()
  assert_eq(first.kind(), 0)
  assert_eq(second.kind(), 0)
  first.release()
  assert_eq(second.text(), "{\"value\":7}")
  second.release()
  context.destroy()
  engine.destroy()
}

///|
test "QJS-02 a released lease fails closed without dereferencing freed memory" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let lease = context.eval_raw("({ stale: true })", "qjs-02-stale.js")
  lease.release()
  assert_eq(lease.kind(), -1)
  assert_eq(lease.text(), "released value handle")
  let duplicate = lease.dup()
  assert_eq(duplicate.kind(), -1)
  duplicate.release()
  context.destroy()
  engine.destroy()
}

///|
test "QJS-05 invalid UTF-8 and a low memory limit fail as typed engine errors" {
  let engine = Engine::new_with_limit(1048576L)
  let context = Context::new(engine)
  let invalid = context.eval_bytes(b"\xff\xfe", b"qjs-05-invalid.js")
  assert_eq(invalid.kind(), 1)
  let invalid_text = invalid.text()
  assert_true(invalid_text.length() > 0)
  invalid.release()
  let oom = context.eval_script("new Array(10000000).fill(0)", "qjs-05-oom.js")
  assert_true(oom.status is Exception)
  let after = context.eval_script("6 * 7", "qjs-05-after.js")
  assert_true(after.status is Value)
  assert_eq(after.text, "42")
  context.destroy()
  engine.destroy()
}

///|
test "QJS-03 pending Promise jobs execute through the adapter" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let queued = context.eval_raw(
    "globalThis.__qjs_job = 0; Promise.resolve().then(() => { globalThis.__qjs_job = 1; });",
    "qjs-03-queue.js",
  )
  queued.release()
  assert_true(engine.job_pending())
  assert_eq(engine.execute_one_job(), 1)
  let observed = context.eval_script("globalThis.__qjs_job", "qjs-03-read.js")
  assert_true(observed.status is Value)
  assert_eq(observed.text, "1")
  context.destroy()
  engine.destroy()
}

///|
test "QJS-03 a job that rejects is executed once and later evaluation still works" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let queued = context.eval_raw("Promise.resolve().then(() => { throw new Error('qjs-job'); })", "qjs-03-reject.js")
  queued.release()
  // QuickJS executes the job; unhandled-rejection policy is not yet claimed.
  assert_eq(engine.execute_one_job(), 1)
  let after = context.eval_script("40 + 2", "qjs-03-after.js")
  assert_true(after.status is Value)
  assert_eq(after.text, "42")
  context.destroy()
  engine.destroy()
}

///|
test "QJS-04 interrupt terminates an unbounded script" {
  let engine = Engine::new()
  let context = Context::new(engine)
  engine.interrupt()
  let stopped = context.eval_script("while (true) {}", "qjs-04-loop.js")
  assert_true(stopped.status is Exception)
  engine.clear_interrupt()
  let after = context.eval_script("6 * 7", "qjs-04-after.js")
  assert_true(after.status is Value)
  assert_eq(after.text, "42")
  context.destroy()
  engine.destroy()
}

///|
test "QJS-04 a monotonic deadline interrupts an unbounded script" {
  let engine = Engine::new()
  let context = Context::new(engine)
  engine.set_deadline(Engine::now_ms() + 50L)
  let stopped = context.eval_script("while (true) {}", "qjs-04-deadline.js")
  assert_true(stopped.status is Exception)
  engine.clear_deadline()
  let after = context.eval_script("6 * 7", "qjs-04-deadline-after.js")
  assert_true(after.status is Value)
  assert_eq(after.text, "42")
  assert_eq(context.live_count(), 0)
  context.destroy()
  engine.destroy()
}

///|
test "global, string and call arguments keep explicit ownership" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let queued = context.eval_raw(
    "globalThis.__qjs_call = function (left, right) { return left + right; };",
    "qjs-call-setup.js",
  )
  queued.release()
  let function_lease = context.get_global("__qjs_call")
  assert_eq(function_lease.kind(), 0)
  let left = context.new_string("ab")
  let right = context.new_string("cd")
  let result = function_lease.call2(left, right)
  assert_eq(result.text(), "\"abcd\"")
  assert_eq(context.live_count(), 4)
  result.release()
  left.release()
  right.release()
  function_lease.release()
  assert_eq(context.live_count(), 0)
  context.destroy()
  engine.destroy()
}

///|
test "class declarations evaluate after the undefined text fix" {
  let engine = Engine::new()
  let context = Context::new(engine)
  let result = context.eval_script("class X { constructor() { this.value = 7; } } new X().value", "qjs-class.js")
  assert_true(result.status is Value)
  assert_eq(result.text, "7")
  context.destroy()
  engine.destroy()
}
