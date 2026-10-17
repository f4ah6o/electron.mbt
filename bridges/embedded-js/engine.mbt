// Minimal QuickJS native FFI. This package is gated to the native target; the
// public surface deliberately exposes explicit lifetime operations rather than
// pretending a C pointer is a MoonBit-managed object.

///|
#external
type Engine

///|
#external
type Context

///|
#external
type ValueLease

///|
extern "C" fn emb_engine_create() -> Engine = "moonbit_emb_engine_create"

///|
extern "C" fn emb_engine_create_with_limit(memory_limit : Int64) -> Engine = "moonbit_emb_engine_create_with_limit"

///|
extern "C" fn emb_engine_destroy(engine : Engine) = "moonbit_emb_engine_destroy"

///|
extern "C" fn emb_interrupt(engine : Engine) = "moonbit_emb_interrupt"

///|
extern "C" fn emb_clear_interrupt(engine : Engine) = "moonbit_emb_clear_interrupt"

///|
extern "C" fn emb_context_create(engine : Engine) -> Context = "moonbit_emb_context_create"

///|
extern "C" fn emb_context_destroy(context : Context) = "moonbit_emb_context_destroy"

///|
#borrow(source, filename)
extern "C" fn emb_eval(
  context : Context,
  source : Bytes,
  filename : Bytes,
) -> ValueLease = "moonbit_emb_eval"

///|
extern "C" fn emb_value_kind(value : ValueLease) -> Int = "moonbit_emb_value_kind"

///|
extern "C" fn emb_value_text(value : ValueLease) -> Bytes = "moonbit_emb_value_text"

///|
extern "C" fn emb_value_dup(value : ValueLease) -> ValueLease = "moonbit_emb_value_dup"

///|
extern "C" fn emb_call(value : ValueLease) -> ValueLease = "moonbit_emb_call"

///|
extern "C" fn emb_value_release(value : ValueLease) = "moonbit_emb_value_release"

///|
extern "C" fn emb_execute_one_job(engine : Engine) -> Int = "moonbit_emb_execute_one_job"

///|
extern "C" fn emb_job_pending(engine : Engine) -> Int = "moonbit_emb_job_pending"

///|
extern "C" fn emb_collect(engine : Engine) = "moonbit_emb_collect"

///|
extern "C" fn emb_memory_used(engine : Engine) -> Int64 = "moonbit_emb_memory_used"

///|
pub(all) enum EvalStatus {
  Value
  Exception
}

///|
pub struct EvalResult {
  status : EvalStatus
  text : String
}

///|
pub fn Engine::new() -> Engine {
  emb_engine_create()
}

///|
pub fn Engine::new_with_limit(memory_limit : Int64) -> Engine {
  emb_engine_create_with_limit(memory_limit)
}

///|
pub fn Engine::destroy(self : Engine) -> Unit {
  emb_engine_destroy(self)
}

///|
pub fn Engine::interrupt(self : Engine) -> Unit {
  emb_interrupt(self)
}

///|
pub fn Engine::clear_interrupt(self : Engine) -> Unit {
  emb_clear_interrupt(self)
}

///|
pub fn Engine::execute_one_job(self : Engine) -> Int {
  emb_execute_one_job(self)
}

///|
pub fn Engine::job_pending(self : Engine) -> Bool {
  emb_job_pending(self) == 1
}

///|
pub fn Engine::collect(self : Engine) -> Unit {
  emb_collect(self)
}

///|
pub fn Engine::memory_used(self : Engine) -> Int64 {
  emb_memory_used(self)
}

///|
pub fn Context::new(engine : Engine) -> Context {
  emb_context_create(engine)
}

///|
pub fn Context::destroy(self : Context) -> Unit {
  emb_context_destroy(self)
}

///|
pub fn Context::eval_raw(
  self : Context,
  source : String,
  filename : String,
) -> ValueLease {
  emb_eval(self, @utf8.encode(source), @utf8.encode(filename))
}

///|
pub fn Context::eval_bytes(
  self : Context,
  source : Bytes,
  filename : Bytes,
) -> ValueLease {
  emb_eval(self, source, filename)
}

///|
pub fn ValueLease::kind(self : ValueLease) -> Int {
  emb_value_kind(self)
}

///|
pub fn ValueLease::text(self : ValueLease) -> String {
  @utf8.decode_lossy(emb_value_text(self))
}

///|
pub fn ValueLease::dup(self : ValueLease) -> ValueLease {
  emb_value_dup(self)
}

///|
pub fn ValueLease::call(self : ValueLease) -> ValueLease {
  emb_call(self)
}

///|
pub fn ValueLease::release(self : ValueLease) -> Unit {
  emb_value_release(self)
}

///|
pub fn Context::eval_script(
  self : Context,
  source : String,
  filename : String,
) -> EvalResult {
  let lease = self.eval_raw(source, filename)
  let kind = lease.kind()
  let text = lease.text()
  lease.release()
  if kind == 1 {
    { status: Exception, text }
  } else if kind < 0 {
    { status: Exception, text: "invalid value lease" }
  } else {
    { status: Value, text }
  }
}
