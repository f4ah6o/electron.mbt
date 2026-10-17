///|
fn scheduler_ok(result : Result[Int32, SchedulerError]) -> Int32 raise {
  match result {
    Ok(id) => id
    Err(_) => {
      assert_true(false)
      -1
    }
  }
}

///|
test "timers fire in deadline order and stop being pending" {
  let scheduler = Scheduler::new(8)
  let first = scheduler_ok(scheduler.set_timeout(100, 1))
  let second = scheduler_ok(scheduler.set_timeout(50, 2))
  assert_eq(scheduler.pending_count(), 2)
  assert_eq(scheduler.next_deadline(), Some(50L))
  assert_eq(scheduler.take_due(49, 8), Ok([]))
  assert_eq(scheduler.take_due(50, 8), Ok([2]))
  assert_eq(scheduler.pending_count(), 1)
  assert_eq(scheduler.take_due(100, 8), Ok([1]))
  assert_eq(scheduler.pending_count(), 0)
  assert_true(first != second)
}

///|
test "same-deadline timers preserve registration order" {
  let scheduler = Scheduler::new(8)
  let a = scheduler_ok(scheduler.set_timeout(10, 10))
  let b = scheduler_ok(scheduler.set_timeout(10, 11))
  let c = scheduler_ok(scheduler.set_timeout(10, 12))
  assert_true(a < b && b < c)
  assert_eq(scheduler.take_due(10, 2), Ok([10, 11]))
  assert_eq(scheduler.take_due(10, 2), Ok([12]))
}

///|
test "cancelled and negative-delay timers are handled explicitly" {
  let scheduler = Scheduler::new(8)
  let cancelled = scheduler_ok(scheduler.set_timeout(10, 1))
  assert_true(scheduler.clear_timeout(cancelled))
  assert_false(scheduler.clear_timeout(cancelled))
  assert_eq(scheduler.take_due(10, 8), Ok([]))
  let immediate = scheduler_ok(scheduler.set_timeout(-5, 2))
  assert_eq(scheduler.take_due(10, 8), Ok([2]))
  assert_eq(scheduler.pending_count(), 0)
  assert_true(immediate > 0)
}

///|
test "non-monotonic time and timer limits fail closed" {
  let scheduler = Scheduler::new(2)
  assert_eq(scheduler.advance_to(10), Ok(()))
  assert_eq(scheduler.advance_to(9), Err(NonMonotonicTime))
  let _ = scheduler_ok(scheduler.set_timeout(1, 1))
  let _ = scheduler_ok(scheduler.set_timeout(1, 2))
  assert_eq(scheduler.set_timeout(1, 3), Err(LimitExceeded))
}

///|
test "unref timers do not keep the runner alive but remain pending" {
  let scheduler = Scheduler::new(8)
  let _ = scheduler_ok(scheduler.set_timeout(100, 1, unref=true))
  let _ = scheduler_ok(scheduler.set_timeout(200, 2))
  assert_eq(scheduler.pending_count(), 2)
  assert_eq(scheduler.ref_count(), 1)
  assert_eq(scheduler.next_deadline(), Some(200L))
  assert_eq(scheduler.take_due(100, 8), Ok([1]))
  assert_eq(scheduler.next_deadline(), Some(200L))
}

///|
test "timers can be scheduled after a due batch" {
  let scheduler = Scheduler::new(8)
  let _ = scheduler_ok(scheduler.set_timeout(10, 1))
  assert_eq(scheduler.take_due(10, 8), Ok([1]))
  let _ = scheduler_ok(scheduler.set_timeout(10, 2))
  assert_eq(scheduler.take_due(20, 8), Ok([2]))
  assert_eq(scheduler.pending_count(), 0)
}

///|
test "compaction removes cancelled entries without changing live order" {
  let scheduler = Scheduler::new(8)
  let a = scheduler_ok(scheduler.set_timeout(10, 1))
  let _ = scheduler_ok(scheduler.set_timeout(20, 2))
  assert_true(scheduler.clear_timeout(a))
  scheduler.compact()
  assert_eq(scheduler.pending_count(), 1)
  assert_eq(scheduler.next_deadline(), Some(20L))
}
