///|
test "runner executes QuickJS jobs and keeps later evaluation usable" {
  let runner = Runner::new()
  let queued = runner.eval(
    "globalThis.__runner_job = 0; Promise.resolve().then(() => { globalThis.__runner_job = 1; });",
    "runner-job.js",
  )
  assert_true(queued.status is @engine.Value)
  let jobs = runner.run_jobs(8)
  assert_eq(jobs.status, Idle)
  assert_eq(jobs.executed, 1)
  let observed = runner.eval("globalThis.__runner_job", "runner-job-read.js")
  assert_true(observed.status is @engine.Value)
  assert_eq(observed.text, "1")
  runner.destroy()
}

///|
test "runner consumes a rejecting job without corrupting the next turn" {
  let runner = Runner::new()
  let queued = runner.eval(
    "Promise.resolve().then(() => { throw new Error('runner-job-error'); });",
    "runner-job-fail.js",
  )
  assert_true(queued.status is @engine.Value)
  let jobs = runner.run_jobs(8)
  assert_eq(jobs.status, Idle)
  let after = runner.eval("40 + 2", "runner-after-fail.js")
  assert_true(after.status is @engine.Value)
  assert_eq(after.text, "42")
  runner.destroy()
}

///|
test "runner shares timer ownership with the QuickJS context" {
  let runner = Runner::new()
  let first = match runner.schedule_timeout(50L, 7) {
    Ok(id) => id
    Err(_) => {
      assert_true(false)
      -1
    }
  }
  let second = match runner.schedule_timeout(10L, 8) {
    Ok(id) => id
    Err(_) => {
      assert_true(false)
      -1
    }
  }
  assert_eq(runner.next_deadline(), Some(10L))
  assert_eq(runner.take_due(10, 8), Ok([8]))
  assert_eq(runner.take_due(50, 8), Ok([7]))
  assert_true(first != second)
  runner.destroy()
}

///|
test "runner exposes the pre-resolved CJS graph path" {
  let runner = Runner::new()
  let source = @engine.ModuleSource::new(
    "entry", "sha256:entry", "module.exports = { answer: 42 };", {}, false,
  )
  let result = runner.eval_cjs([source], "entry")
  assert_true(result.status is @engine.Value)
  assert_eq(result.exports, "{\"answer\":42}")
  runner.destroy()
}
