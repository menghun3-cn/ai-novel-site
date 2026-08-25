# Agent Note: AI serialization admin endpoints

Status: implemented

English | [中文](2026-08-24-ai-serial-api.md)

## Problem

The V5 core (config table, job queue, daily cycle) shipped without HTTP
surface: the operator console could neither view/change per-book
serialization config, batch-enqueue "generate the first N chapters",
manually drain the queue, nor browse job history. The scheduler was the only
executor.

## Decision

Four route groups, all behind `withAdmin`:

- `GET/PUT /api/admin/books/[id]/ai-serialization` — book-scoped config.
  GET returns the virtual default for unconfigured books; PUT accepts a
  partial patch (`enabled/hour/count/autoPublish/minChars`) with zod bounds
  mirroring the service rules. Dynamic-route context is the explicit
  `{ params: Promise<{ id }> }` shape (Next 15).
- `POST /api/admin/ai/serial/enqueue` — `{bookId, count≤50}`; returns the
  created pending jobs. Execution is deliberately **not** inline: real LLM
  batches would exceed request budgets, so enqueue only records intent.
- `POST /api/admin/ai/serial/run` — `{limit?}` drains up to N pending jobs
  through the same executor the scheduler uses and returns the fresh jobs
  list, letting the UI refresh in one round trip.
- `GET /api/admin/ai/serial/jobs?bookId=&limit=` — newest-first history,
  optionally filtered by book.

Verification: `npm run test:ai-serial-api` (14 assertions) drives the real
route handlers directly against a local mock OpenAI upstream: default vs
saved config, zod-bound rejections with an error code in the body, auth
required on every verb, batch enqueue counts, manual run processing both
jobs to `published` under autoPublish with dense chapter numbering from 1,
and filtered listing. typecheck and production build green.

## Alternatives considered

**Inline generation inside POST /enqueue.** Lost: a 20-chapter batch against
a real gateway would run minutes and die on proxy timeouts; separating
intent (enqueue) from execution (run/scheduler) keeps requests snappy.

**One generic `/jobs` mutation endpoint with action enums.** Rejected: three
narrow verbs document themselves and map 1:1 to UI buttons; a switch-on-
action handler would grow into a mini-DSL.

## Consequences

Gained: full operator control over the V5 loop from the console, including a
manual "drain now" that shares semantics with the nightly cycle. Costs:
`POST /serial/run` is synchronous and can take as long as its jobs (bounded
by limit≤100); acceptable while jobs are sequential, but if concurrency
arrives later this should become a 202 + polling pattern.
