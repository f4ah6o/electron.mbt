///|
pub(all) enum SchedulerError {
  LimitExceeded
  InvalidId
  NonMonotonicTime
} derive(Eq, Debug)

///|
struct Timer {
  id : Int32
  deadline : Int64
  callback : Int32
  sequence : Int64
  unref : Bool
  cancelled : Bool
}

///|
// Deterministic timer ownership for the native runner. The scheduler does not
// execute JavaScript callbacks; it returns callback IDs in the order the runner
// must invoke them. Wall-clock time is supplied by the host, never read here.
pub struct Scheduler {
  mut timers : Array[Timer]
  mut now : Int64
  mut next_id : Int32
  mut next_sequence : Int64
  max_timers : Int32
}

///|
pub fn Scheduler::new(max_timers : Int32) -> Scheduler {
  {
    timers: [],
    now: 0,
    next_id: 1,
    next_sequence: 0,
    max_timers,
  }
}

///|
pub fn Scheduler::now(self : Scheduler) -> Int64 {
  self.now
}

///|
pub fn Scheduler::pending_count(self : Scheduler) -> Int32 {
  let mut count = 0
  for timer in self.timers {
    if !timer.cancelled {
      count += 1
    }
  }
  count
}

///|
pub fn Scheduler::ref_count(self : Scheduler) -> Int32 {
  let mut count = 0
  for timer in self.timers {
    if !timer.cancelled && !timer.unref {
      count += 1
    }
  }
  count
}

///|
pub fn Scheduler::advance_to(self : Scheduler, now : Int64) -> Result[Unit, SchedulerError] {
  if now < self.now {
    return Err(NonMonotonicTime)
  }
  self.now = now
  Ok(())
}

///|
// Timeouts may be scheduled at the current instant. Negative delays are
// clamped to zero, matching the browser/Node convention for a due timer.
pub fn Scheduler::set_timeout(
  self : Scheduler,
  delay_ms : Int64,
  callback : Int32,
  unref? : Bool = false,
) -> Result[Int32, SchedulerError] {
  if self.pending_count() >= self.max_timers {
    return Err(LimitExceeded)
  }
  if self.next_id == 2147483647 {
    return Err(LimitExceeded)
  }
  let delay : Int64 = if delay_ms < 0 { 0 } else { delay_ms }
  let id = self.next_id
  self.next_id += 1
  let sequence = self.next_sequence
  self.next_sequence += 1
  self.timers.push({
    id,
    deadline: self.now + delay,
    callback,
    sequence,
    unref,
    cancelled: false,
  })
  Ok(id)
}

///|
pub fn Scheduler::clear_timeout(self : Scheduler, id : Int32) -> Bool {
  for i = 0; i < self.timers.length(); i = i + 1 {
    let timer = self.timers[i]
    if timer.id == id && !timer.cancelled {
      self.timers[i] = {
        id: timer.id,
        deadline: timer.deadline,
        callback: timer.callback,
        sequence: timer.sequence,
        unref: timer.unref,
        cancelled: true,
      }
      return true
    }
  }
  false
}

///|
fn timer_before(left : Timer, right : Timer) -> Int {
  if left.deadline != right.deadline {
    if left.deadline < right.deadline { -1 } else { 1 }
  } else if left.sequence < right.sequence {
    -1
  } else if left.sequence > right.sequence {
    1
  } else {
    0
  }
}

///|
fn Scheduler::take_due_timers(
  self : Scheduler,
  now : Int64,
  limit : Int32,
) -> Result[Array[Timer], SchedulerError] {
  if now < self.now {
    return Err(NonMonotonicTime)
  }
  self.now = now
  let due : Array[Timer] = []
  for timer in self.timers {
    if !timer.cancelled && timer.deadline <= now {
      due.push(timer)
    }
  }
  due.sort_by(timer_before)
  let selected : Array[Timer] = []
  for timer in due {
    if selected.length() >= limit {
      break
    }
    selected.push(timer)
  }
  if selected.length() > 0 {
    let remaining : Array[Timer] = []
    for timer in self.timers {
      let mut remove = false
      for chosen in selected {
        if chosen.id == timer.id {
          remove = true
        }
      }
      if !remove {
        remaining.push(timer)
      }
    }
    self.timers = remaining
  }
  Ok(selected)
}

///|
// Return due callback IDs in (deadline, registration sequence) order and remove
// them. The runner variant below returns timer IDs so it can join the callback
// lease map without guessing a preassigned callback number.
pub fn Scheduler::take_due(
  self : Scheduler,
  now : Int64,
  limit : Int32,
) -> Result[Array[Int32], SchedulerError] {
  match self.take_due_timers(now, limit) {
    Ok(timers) => {
      let callbacks : Array[Int32] = []
      for timer in timers {
        callbacks.push(timer.callback)
      }
      Ok(callbacks)
    }
    Err(error) => Err(error)
  }
}

///|
pub fn Scheduler::take_due_ids(
  self : Scheduler,
  now : Int64,
  limit : Int32,
) -> Result[Array[Int32], SchedulerError] {
  match self.take_due_timers(now, limit) {
    Ok(timers) => {
      let ids : Array[Int32] = []
      for timer in timers {
        ids.push(timer.id)
      }
      Ok(ids)
    }
    Err(error) => Err(error)
  }
}

///|
// The next deadline that should keep the runner alive. Unref timers alone do
// not keep the process alive and therefore return None.
pub fn Scheduler::next_deadline(self : Scheduler) -> Int64? {
  let mut next : Int64? = None
  for timer in self.timers {
    if timer.cancelled || timer.unref {
      continue
    }
    match next {
      None => next = Some(timer.deadline)
      Some(value) =>
        if timer.deadline < value {
          next = Some(timer.deadline)
        }
    }
  }
  next
}

///|
// Remove cancelled entries once they are no longer needed for diagnostics.
pub fn Scheduler::compact(self : Scheduler) -> Unit {
  let kept : Array[Timer] = []
  for timer in self.timers {
    if !timer.cancelled {
      kept.push(timer)
    }
  }
  self.timers = kept
}
