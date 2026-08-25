# Agent Note: Publishing HTTP API and resident scheduler

Status: implemented

English | [中文](2026-08-23-publish-scheduler-api.zh.md)

## Problem

The review workflow and autopilot existed only as service functions
([related](2026-08-23-publish-review-workflow.md)); operators had no HTTP
surface to submit/approve/reject chapters, inspect the review queue, or
configure per-book autopilot — and nothing executed `runPublishCycle`
periodically, so scheduled chapters sat forever.

## Decision

Four admin endpoints, all behind `withAdmin`:

- `POST /api/admin/books/[id]/chapters/[number]/review` — body
  `{action:'submit'} | {action:'approve',mode:'now'|'scheduled',scheduledAt?} |
  {action:'reject',note?}`; zod discriminated union, 400 on missing
  `scheduledAt`, service errors mapped (409 invalid transition, 404 unknown)
- `GET /api/admin/review-queue?limit&offset` — FIFO queue with book summary
- `GET|PUT /api/admin/books/[id]/autopilot` — config read/update; route-level
  zod bounds (hour 0–23, count 1–50) reject early as VALIDATION_FAILED while
  the service guard remains as defense in depth
- `POST /api/admin/publish/run` — manual `runPublishCycle()` trigger

The generic chapter PATCH now also accepts `status:'pending_review'` so the
schema matches the domain enum.

Automation is `scripts/publish-scheduler.ts` (`npm run scheduler`): a
sequential loop (no overlapping ticks) calling `runPublishCycle` every
`PUBLISH_TICK_SECONDS` (default 60, floor 5s), logging only cycles that
published something, catching per-cycle errors without dying, and stopping
cleanly on SIGINT/SIGTERM. Verification: `npm run test:publish-api` (16
handler-level assertions covering auth, happy paths, 400/404/409 mappings,
queue shape, config round-trip) plus a live smoke run of the scheduler
process; full typecheck and production build pass.

## Alternatives considered

**Cron + one-shot CLI instead of a resident loop.** Deferred: host cron is
deployment-specific and the repo currently ships Docker-less; the in-process
loop keeps V3 self-contained, and the tick function is reusable by any
external scheduler later.

**Webhook/queue system (BullMQ etc.) for scheduling.** Lost: a Redis
dependency for at-most-daily per-book jobs is heavy; SQLite transactions
already give atomicity for the due-scan.

**Folding review actions into PATCH /chapters/[number].** Lost: approve needs
a mode+time payload that muddies the edit schema, and a dedicated endpoint
gives audit-friendly semantics; the generic PATCH still allows direct status
writes for power users.

**Auto-starting the scheduler inside next start.** Lost: two processes
writing is fine but lifecycle coupling means a web restart kills publishing;
separate process = independent restart/scale, matching how the importer stays
standalone.

## Consequences

Gained: the whole V3 loop is drivable over HTTP and runs unattended once
`scheduler` is added to the deployment's process list; manual trigger covers
ops debugging. Cost: exactly-one-scheduler-process is an operational
assumption (two schedulers would double-fire autopilot within the same day
boundary race); the tick loop sleeps rather than aligns to wall-clock minute
boundaries, so "08:00" can fire up to one tick late.
