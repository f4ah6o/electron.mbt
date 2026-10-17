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
