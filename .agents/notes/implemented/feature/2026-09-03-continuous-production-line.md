# Agent Note: Continuous production lines — backpressure-driven creation with a circuit breaker

Status: implemented

English | [中文](2026-09-03-continuous-production-line.zh.md)

## Problem

The V10 production line (产线) could only run `manual` or `daily` schedules. A
user who wants the platform to keep producing short stories without stopping —
each story going through the full pipeline (生成 → 评审 → 自动优化 → 发布/入池)
and then publishing — had no mechanism: `daily` fires once per day with a
same-day dedupe, and nothing stops runaway cost or repeated failures. There was
also no built-in random genre pool (kinds had to be configured explicitly), and
the only stop gate was manual `enabled=false`.

## Decision

Extended the existing production line (`core/src/production-line.ts`) with a
`continuous` schedule mode instead of building a new entity. Three mechanisms
ship together:

1. **Backpressure-driven gap-free production (no interval).** `continuous`
   lines are checked every scheduler tick (`PUBLISH_TICK_SECONDS`, default 60s,
   minimum 5s) by `listDueContinuousProductionLines()` /
   `fireDueContinuousProductionRuns()`. A line fires when `enabled=1`, not
   tripped, and its in-flight story count is below `max(2, count*2)`. In-flight
   counts `draft` stories too — a story is `draft` from creation until the
   worker picks up its `CREATE_NOVEL` task, so excluding it would let the
   scheduler enqueue unboundedly faster than workers consume. A deliberately
   rejected `intervalSeconds` config keeps the design honest: any fixed
   interval would manufacture gaps, contradicting gap-free production.
2. **Stop gates: manual pause OR consecutive-failure circuit breaker.**
   `production_lines` gained `consecutive_failures`,
   `max_consecutive_failures` (default 3, configurable 1..20),
   `tripped_reason`, `tripped_at`. Failure is counted per **run**: a throwing
   `runProductionLine` bumps the counter; a successful run resets it. At
   threshold the line auto-disables with reason/timestamp; `resumeProductionLine`
   re-enables and clears the counter (idempotent). Manual pause via
   `enabled=false` leaves the counter untouched. `isLineTripped()` exposes the
   state for badges. Daily quota (`dailyLimit` / `dailyBudgetUsd`) still applies
   to `continuous` lines as a soft ceiling.
3. **Built-in random genre pool (`DEFAULT_KINDS`).** 10 genres × 3 seed themes
   each. A `continuous` line with no `kinds` gets the pool injected (default =
   random); explicit kinds still win. Each continuous run shuffles kind order
   and jitters weights ±20% (min 1) so consecutive rounds don't repeat the same
   mix. `manual`/`daily` still reject empty kinds (backward compatible).

Observation surfaces were extended in `production-ops.ts`: overview lanes and
`getProductionLinesWithMeta()` return `inFlight` / `backpressureThreshold` for
continuous lines; a `tripped_line` alert and a tripped-line exception with a
`resume_line` action appear in the ops center. The admin UI (creation center)
gains the continuous form (mode, per-round count 1..10, breaker threshold, and
a second confirmation when no daily limit / budget is set), 持续/已熔断 badges,
a 恢复 action, and a 持续创作 status card in the overview.

## Alternatives considered

**New standalone entity.** A separate `continuous_creation_tasks` table would
have clearer semantics but duplicates the line machinery (kinds, quota, quality
gate, run records, ops aggregation) and splits maintenance. Extending the
existing line reuses `runProductionLine`, `ai_tasks`, the publication
materialization, and production-ops for free.

**Fixed interval (e.g. every 30s).** A round of `count` stories takes minutes
(LLM generation + review + possible optimization), so a fixed interval either
stacks up an unbounded queue or idles. Backpressure — fire only when in-flight
drops below threshold — produces true gap-free production whose pace tracks
consumption speed.

## Consequences

- Continuous lines run unattended until manually paused or tripped; the
  scheduler tick is the trigger granularity and restart-safe (a restart simply
  resumes the due check).
- `production_runs.trigger` now includes `'continuous'`; the run record keeps
  the full audit trail (errors land on the run and in `ai_tasks`).
- Cost is bounded by `dailyLimit` / `dailyBudgetUsd` only if configured; the UI
  shows a second confirmation when neither is set, since unlimited production
  means unlimited spend.
- The circuit breaker counts run-level throws. A round that creates stories but
  every story fails review does not trip it — a known gap, deliberately
  deferred (see the design doc §8).
- Verified by `scripts/verify-continuous-production-line.ts` (multi-round,
  backpressure, breaker → resume, random pool, ops aggregation); no regression
  in `scripts/verify-production-line.ts`.
