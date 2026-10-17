# Embedded scheduler contract (EP-09)

Status: pure MoonBit contract increment; **partial**. Timer ownership, ordering,
limits and cancellation are implemented and tested. The scheduler is not yet
connected to QuickJS jobs/nextTick/host events, and no process-liveness or
Node-compatible unhandled-rejection policy is claimed.

## Ownership

`runtime/embedded/scheduler.mbt` owns:

- timer IDs, deadlines, registration sequence and cancellation;
- the current monotonic time supplied by the host;
- the due-batch order `(deadline, registration sequence)`;
- the timer count/ref-count limits and next ref deadline.

It does not execute JavaScript and does not read wall-clock time. The native
runner must invoke the returned callback IDs in order and then return to the
scheduler. A timer registered after a due batch is considered by the next call,
not retroactively inserted into the current batch.

## Contract

| Operation | Behavior |
| --- | --- |
| `set_timeout(delay, callback, unref?)` | negative delay clamps to zero; returns monotonic ID; rejects at the timer limit |
| `clear_timeout(id)` | most recent live ID is cancelled; repeated clear returns false |
| `take_due(now, limit)` | rejects non-monotonic time; returns up to `limit` callback IDs in deterministic order and removes them |
| `take_due_ids(now, limit)` | same batch selection, but returns timer IDs for the runner's lease map |
| `next_deadline()` | earliest live ref timer; unref-only timers return `None` |
| `advance_to(now)` | monotonic host clock update |
| `compact()` | drops cancelled entries without changing live order |

Initial limits are 1,024 pending timers per scheduler and a signed-32-bit ID
space; both are contract values, not measured performance claims.

## Verified

`moon test --target js` and `moon test --target native` pass the scheduler
tests: deadline order, same-deadline registration order, cancellation, negative
delay, non-monotonic rejection, timer limit, unref semantics, reentrant
post-batch scheduling and compaction.

## Open

- connect due callbacks to the QuickJS runner and `JS_ExecutePendingJob`;
- nextTick/microtask/timer partial-order fixtures and unhandled-rejection policy;
- timer callbacks that throw, re-enter, or are cancelled while running;
- host-loss/shutdown deadlines and root accounting;
- a Node-backed differential timer trace (the pure contract is not a Node parity claim).
