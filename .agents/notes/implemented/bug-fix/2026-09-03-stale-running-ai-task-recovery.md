# Agent Note: Stale RUNNING ai_tasks are never re-queued after the executor dies

Status: implemented

English | [中文](2026-09-03-stale-running-ai-task-recovery.zh.md)

## Problem

`ai_tasks` rows are claimed by `processAiTasks()`: `startAiTask()` flips a
`PENDING` task to `RUNNING`, the task runs, then `completeAiTask()` /
`failAiTask()` settle it. The picker `claimPendingTasks()` only ever selects
`status = 'PENDING'`, and there is no timeout or crash-recovery path for
`RUNNING` rows.

When the executor process disappears mid-run — a container rebuild or crash
during a `docker compose up -d --build` deploy, an OOM kill, a manual restart —
the `RUNNING` row is orphaned forever: nobody re-claims it, it never settles,
and the creation center keeps showing the story as 执行中 (executing)
indefinitely. This was observed in production (2026-09-03): a `CREATE_NOVEL`
task for short story `ss_5d3fe803d3ae409fb130` was claimed 44 s before the
`novel-web`/`novel-scheduler` containers were rebuilt at 06:11:35Z; it stayed
`RUNNING` for hours, blocking that story's pipeline while sibling stories from
the same batch completed and published normally.

## Decision

Add a stale-`RUNNING` recovery step driven by the scheduler:

- `recoverStaleRunningTasks(maxAgeMs = 10 * 60 * 1000)` in `core/src/ai-task.ts`
  resets every task whose `status = 'RUNNING'` and `started_at` is older than
  the threshold back to `PENDING`, clearing execution traces
  (`started_at`/`finished_at`/`duration_ms`/`error`/`output_json`) while
  preserving the `attempt` count (retry history stays visible). The reset runs
  in one transaction.
- The scheduler tick (`scripts/publish-scheduler.ts`) calls it once per tick,
  right before `processAiTasks()`, so recovered tasks are re-claimed and
  re-executed in the same cycle. Recovered count and ids are logged as
  `stale-recovered: count=N ids=...`.
- The threshold is configurable via `AI_TASK_STALE_GRACE_MS` (ms, lower bound
  60000, default 600000). The default is far above the longest normal task
  (whole-story generation ≈ 3 min), so in-flight tasks are never mistaken for
  zombies.
- Only the scheduler recovers; the web-side `story-worker.ts` does not, so a
  task the web worker is genuinely executing cannot be double-run by recovery.

## Alternatives considered

**Re-claim on executor startup (like `scheduler-lock.ts`'s stale takeover).**
The lock file carries a pid/hostname and is refreshed every tick, so a new
scheduler instance can tell a live holder from a dead one. Tasks carry no
executor identity at all, so a startup sweep cannot tell a genuinely in-flight
task (e.g. web worker still running it) from an orphan. A time-based sweep
inside the tick is the only signal available, and ticking once per minute
bounds recovery latency anyway.

**Heartbeat / lease on each task row.** Robust (task rows would carry a
refresh timestamp), but adds a write per tick per in-flight task and a
migration; the 10-minute time threshold achieves the same practical outcome
with zero schema change.

**Manual admin "re-run" button only.** Leaves the creation center stuck until
a human notices; the whole failure mode is that nobody notices for hours.

**Recovery in `claimPendingTasks()` itself.** Would silently mutate rows on
every picker call including the web worker's, reintroducing the double-run
risk this fix explicitly avoids.

## Consequences

- A container rebuild/crash during an `ai_tasks` run no longer leaves a
  permanent 执行中 zombie: the next scheduler tick (≤ 60 s) re-queues it and
  the pipeline finishes.
- `attempt` is preserved, so retry history and failure observability are
  intact; execution metadata is cleared so the re-run starts clean.
- The web-side worker is deliberately excluded from recovery: if the *web*
  container crashes, the scheduler (a separate container) still recovers its
  orphans; if the scheduler container itself crashes, the web worker keeps
  processing `PENDING` tasks until the scheduler returns.
- Cost: a task legitimately running longer than the grace period (LLM call
  hung past 10 minutes, or a future task type with longer runtime) would be
  re-queued while the original executor may still be alive — a double-run
  window bounded by how far past the threshold the original call runs. At the
  current max task duration (~3 min) this is not reachable.
- Verification: `scripts/verify-stale-task-recovery.ts` covers stale recovery,
  in-threshold non-recovery, untouched `PENDING`/fresh-`RUNNING` rows,
  re-claimability, and end-to-end re-execution success.

## Related

- [background generation execution](../feature/2026-08-24-background-generation.md)
  records the same known gap for `generation_jobs` (V5 serialization jobs stay
  `running` after a process restart). This note covers `ai_tasks` only; the
  `generation_jobs` sweep remains an open follow-up.
