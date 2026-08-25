# Agent Note: Chapter review workflow and per-book autopilot

Status: implemented

English | [中文](2026-08-23-publish-review-workflow.zh.md)

## Problem

The roadmap's V3 publishing core requires that generated content never goes
live unreviewed: Draft → Quality Check → Review → Scheduled → Published.
V2's chapter state machine
([related](2026-08-23-admin-book-chapter-management.md)) had no review gate —
a draft could be flipped straight to `published` with one PATCH — and "每天
08:00 自动发布 1 章" serialization had no storage or executor.

## Decision

`CHAPTER_STATUSES` gains `'pending_review'`, and chapters gain a nullable
`review_note` (rejection feedback, cleared on resubmit/approve). Three
service methods enforce the strict transitions, each bumping the parent
book's `updated_at`:

- `submitChapterForReview`: only `draft` → `pending_review`
- `approveChapter(bookId, number, {mode:'now'} | {mode:'scheduled', scheduledAt})`:
  only `pending_review` → published (first-published timestamp semantics
  preserved) or scheduled
- `rejectChapter(bookId, number, note?)`: only `pending_review` → `draft`,
  stores the note

Illegal jumps throw the new `INVALID_REVIEW_TRANSITION` (→409 at the API
layer). `listPendingReview()` returns the FIFO queue with book summaries,
and `BookWithMeta.pendingReviewCount` powers badges/KPIs via a new aggregate
in `BOOK_LIST_SQL`.

Autopilot is per-book config stored on `books` (`autopilot_enabled/hour/
count/last_date`, defaults off / 8 / 1 matching the doc's example) behind
`getAutopilotConfig`/`configureAutopilot` (hour 0–23, count 1–50, else
`INVALID_AUTOPILOT`). The executor is injectable-clock pure service code:
`publishDueChapters(now)` flips due scheduled chapters inside a transaction;
`runAutopilot(now)` fires at most once per local day per book (guarded by
`lastRunDate`) publishing the oldest `count` drafts; `runPublishCycle(now)`
composes both. Old databases are migrated idempotently by
`migratePublishColumns`; a `(status, scheduled_at)` index serves the due
scan. Verification lives in `npm run test:publish` (28 assertions over
transitions, queue order, config validation, idempotent due-scan, and
day-guard behavior against a temp database).

## Alternatives considered

**Autopilot drawing from `pending_review` instead of drafts.** Lost: the
review queue is an explicit human gate — silently auto-approving queued
chapters would defeat its purpose. Autopilot is opt-in per book for trusted
pipelines; operators who want review keep autopilot off.

**A separate `reviewState` column beside `status`.** Lost: two sources of
truth for lifecycle position invites drift; the roadmap itself models review
as a pipeline stage, so it belongs in the status enum.

**Storing rejection reasons only in logs/API responses.** Lost while writing
the reject path: V4's AI engine needs machine-readable rejection feedback to
regenerate; a nullable column is cheap now and expensive later.

**Cron-per-book with arbitrary schedules (e.g. cron strings).** Deferred:
every real example in the roadmap is "daily at HH:MM, N chapters"; a
day-granularity guard plus hour/count covers it without a scheduler DSL or
expression parser.

## Consequences

Gained: content cannot reach readers without passing the configured gates;
serialization automation exists end-to-end at the service layer with a
testable clock. Cost: `updateChapter` still accepts raw `status` patches
(admin full control), so the strict transitions are enforced by the review
methods, not by the generic editor — the UI must route through them; the
scheduler process and its HTTP surface shipped in
[the follow-up note](2026-08-23-publish-scheduler-api.md), and deployment
must include that process for automation to be live.
