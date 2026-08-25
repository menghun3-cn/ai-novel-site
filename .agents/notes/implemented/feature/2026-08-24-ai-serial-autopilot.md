# Agent Note: AI serialization autopilot

Status: implemented

English | [中文](2026-08-24-ai-serial-autopilot.md)

## Problem

The V4 engine could generate and quality-gate one chapter per request, but
everything was operator-driven: no schedule, no batch bootstrap ("generate
the first 10 chapters"), no memory of what the pipeline already produced
today, and the resident scheduler only handled timed publishing (V3). The
roadmap's §8 loop — 每天自动生成 → 自动检查 → 自动发布 — had no machine.

## Decision

Two new tables, one module (`core/src/ai-serial.ts`):

- **`ai_serialization`** — per-book config: `enabled`, `hour` (0-23 local),
  `count` (1-20/day), `autoPublish`, `minChars` (200-20000), `last_run_date`.
  Unconfigured books read a virtual default (disabled / 8:00 / 1 chapter /
  review mode / 500 chars). Validation errors use the new
  `INVALID_AI_SERIALIZATION` code (HTTP 400).
- **`generation_jobs`** — append-style outcome log: `pending → running →`
  `published | submitted | rejected | failed`, with attempt count, error,
  chars, and resolved model name. Rejected jobs consume no chapter number
  (the engine never wrote a draft), so numbering stays dense.

Flow pieces:

- `enqueueGenerationJobs(bookId, count)` — batch bootstrap for "AI 生成前
  N 章" (cap 50 per call).
- `processGenerationJobs(limit)` — claims oldest pending jobs and executes
  each through `generateChapterDraft` with `submitForReview: true`; on
  success either stops at `pending_review` (人工确认) or, when the book has
  `autoPublish`, immediately approves via the V3 `approveChapter(mode:'now')`.
  Provider resolution goes through `resolveProviderFromStore()` (admin
  settings > env) so scheduler and API share identical semantics.
- `runAiSerializationCycle(now)` — for every enabled book whose
  `last_run_date < today` **and** whose hour has arrived: enqueue `count`
  jobs, stamp `last_run_date = today`, then process. The date guard makes
  repeated ticks within a day idempotent.
- The scheduler script now runs the publish cycle **and** this cycle each
  tick; AI failures are logged and never kill the process.

Verification: `npm run test:ai-serial` (24 assertions: defaults, validation
bounds incl. BOOK_NOT_FOUND on read, batch enqueue caps, submit-mode
chapters landing pending_review, autoPublish publishing in place, minChars
passthrough producing rejected-with-zero-writes, dead-upstream job marked
failed without poisoning the queue, day-guard idempotency across simulated
dates, hour-gate blocking an enabled book until its time comes, disabled
books skipped). typecheck + build + full existing suites green.

## Alternatives considered

**Cron outside the app.** Lost: Windows-dev parity and the single-command
ops story; the in-process scheduler already exists from V3.

**Pre-assigned chapter numbers on pending jobs.** Wrong under concurrency:
two sources of generation (manual + cycle) would collide on numbers;
assigning at execution keeps `max+1` authoritative.

**Retries inside executeJob.** Deferred: attempts are recorded but failures
stay terminal until an operator re-enqueues. Auto-retry against a flaky
gateway would burn budget silently; surfacing failure in the jobs list is
the honest default.

## Consequences

Gained: enabling AI serialization is one config save; overnight the system
produces reviewed (or published) chapters within the configured char floor.
Costs/notes: the daily guard is **local-time** based like V3 autopilot (DST
shifts can skip or double-fire once a year); jobs run sequentially inside
one tick, so a slow gateway delays other books' generations behind it
(mitigation later: per-job concurrency); `auto_publish` bypasses human
review by design — treat enabling it as the roadmap's 人工确认 step.
