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
// Minimal in-process integration of the QuickJS engine and timer contract.
// The host still owns the event loop, host events and process supervision; this
// type only proves that jobs and timer ownership can share one runner state.
pub struct Runner {
  engine : @engine.Engine
  context : @engine.Context
  scheduler : @scheduler.Scheduler
}

///|
pub fn Runner::new() -> Runner {
  let engine = @engine.Engine::new()
  let context = @engine.Context::new(engine)
  {
    engine,
    context,
    scheduler: @scheduler.Scheduler::new(1024),
  }
}

///|
pub fn Runner::destroy(self : Runner) -> Unit {
  self.context.destroy()
  self.engine.destroy()
}

///|
pub fn Runner::eval(self : Runner, source : String, filename : String) -> @engine.EvalResult {
  self.context.eval_script(source, filename)
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
