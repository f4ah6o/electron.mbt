///|
pub(all) enum JobsStatus {
  Idle
  Failed
  Limit
} derive(Eq, Debug)

///|
pub struct JobsResult {
  status : JobsStatus
  executed : Int32
}

///|
pub struct DueResult {
  due : Int32
  called : Int32
  callback_failures : Int32
  job_failures : Int32
}

///|
// Minimal in-process integration of the QuickJS engine and timer contract.
// The host still owns the event loop, host events and process supervision; this
// type only proves that jobs and timer ownership can share one runner state.
pub struct Runner {
  engine : @engine.Engine
  context : @engine.Context
  scheduler : @scheduler.Scheduler
  callbacks : Map[Int32, @engine.ValueLease]
}

///|
pub fn Runner::new() -> Runner {
  let engine = @engine.Engine::new()
  let context = @engine.Context::new(engine)
  {
    engine,
    context,
    scheduler: @scheduler.Scheduler::new(1024),
    callbacks: Map([]),
  }
}

///|
pub fn Runner::destroy(self : Runner) -> Unit {
  for _, callback in self.callbacks {
    callback.release()
  }
  self.callbacks.clear()
  self.context.destroy()
  self.engine.destroy()
}

///|
pub fn Runner::eval(self : Runner, source : String, filename : String) -> @engine.EvalResult {
  self.context.eval_script(source, filename)
}

///|
pub fn Runner::eval_lease(self : Runner, source : String, filename : String) -> @engine.ValueLease {
  self.context.eval_raw(source, filename)
}

///|
pub fn Runner::eval_cjs(
  self : Runner,
  modules : Array[@engine.ModuleSource],
  entry : String,
) -> @engine.CjsResult {
  self.context.eval_cjs(modules, entry)
}

///|
// Execute at most `max_steps` pending Promise jobs. A job exception is reported
// separately from an idle queue; the runner does not invent a request timeout.
pub fn Runner::run_jobs(self : Runner, max_steps : Int32) -> JobsResult {
  let mut executed = 0
  while executed < max_steps {
    let result = self.engine.execute_one_job()
    if result == 0 {
      return { status: Idle, executed }
    }
    if result < 0 {
      return { status: Failed, executed }
    }
    executed += 1
  }
  { status: Limit, executed }
}

///|
pub fn Runner::schedule_timeout(
  self : Runner,
  delay_ms : Int64,
  callback : Int32,
  unref? : Bool = false,
) -> Result[Int32, @scheduler.SchedulerError] {
  self.scheduler.set_timeout(delay_ms, callback, unref~)
}

///|
// Retain the JS callback until the timer fires or is cleared. The scheduler
// owns the deadline/ID; this map owns only the realm callback lease.
pub fn Runner::schedule_callback(
  self : Runner,
  delay_ms : Int64,
  callback : @engine.ValueLease,
  unref? : Bool = false,
) -> Result[Int32, @scheduler.SchedulerError] {
  match self.scheduler.set_timeout(delay_ms, 0, unref~) {
    Ok(id) => {
      self.callbacks[id] = callback
      Ok(id)
    }
    Err(error) => Err(error)
  }
}

///|
pub fn Runner::clear_timeout(self : Runner, id : Int32) -> Bool {
  let cleared = self.scheduler.clear_timeout(id)
  if cleared {
    match self.callbacks.remove_and_get(id) {
      Some(callback) => callback.release()
      None => ()
    }
  }
  cleared
}

///|
// Invoke due callbacks in scheduler order, release each lease exactly once, and
// run the resulting Promise jobs before returning. A callback exception is
// reported as a count; it never unwinds through the scheduler.
pub fn Runner::run_due(self : Runner, now : Int64, limit : Int32) -> DueResult {
  let ids = match self.scheduler.take_due_ids(now, limit) {
    Ok(ids) => ids
    Err(_) =>
      return {
        due: 0,
        called: 0,
        callback_failures: 0,
        job_failures: 0,
      }
  }
  let mut called = 0
  let mut callback_failures = 0
  let mut job_failures = 0
  for id in ids {
    match self.callbacks.remove_and_get(id) {
      Some(callback) => {
        let result = callback.call()
        if result.kind() != 0 {
          callback_failures += 1
        }
        result.release()
        callback.release()
        called += 1
        let jobs = self.run_jobs(16)
        if jobs.status == Failed {
          job_failures += 1
        }
      }
      None => ()
    }
  }
  {
    due: ids.length(),
    called,
    callback_failures,
    job_failures,
  }
}

///|
pub fn Runner::take_due(
  self : Runner,
  now : Int64,
  limit : Int32,
) -> Result[Array[Int32], @scheduler.SchedulerError] {
  self.scheduler.take_due(now, limit)
}

///|
pub fn Runner::next_deadline(self : Runner) -> Int64? {
  self.scheduler.next_deadline()
}

///|
pub fn Runner::advance_to(self : Runner, now : Int64) -> Result[Unit, @scheduler.SchedulerError] {
  self.scheduler.advance_to(now)
}
