# Agent Note: Analytics reading sessions & chapter funnel

Status: implemented

English | [中文](2026-08-24-analytics-reading-sessions.zh.md)

## Problem

Roadmap V8 asks for operational analytics — PV, UV, 阅读时长, 章节完成率,
收藏, 订阅, plus per-chapter 流失分析 (e.g. "chapter 4 visibly bleeds
readers") that AI can later reason about. V7 shipped PV/finish counters
and V6 shipped favorites/subscriptions/progress, so most inputs existed
as queryable numbers — but nothing measured *time*, nothing derived
retention or funnel shape, and no admin surface exposed any of it.

## Decision

**One event-shaped table for the one metric a counter cannot express:
duration.** `reading_sessions(id, book_id, chapter_number, started_at,
finished_at, duration_sec)` plus `(book_id, chapter_number)` and
`started_at` indexes lands via the shared DDL `CREATE TABLE IF NOT
EXISTS`; `migrateAnalyticsColumns` is a deliberate no-op placeholder so
the [discovery signals](2026-08-24-discovery-signals.md) lesson holds —
no ALTER TABLE in shared DDL.

- `startReadingSession(bookId, chapterNumber)` in
  `core/src/analytics.ts` dedupes: an unfinished session for the same
  book+chapter started within the last 30s returns the existing id, so
  mount/refresh storms don't multiply rows.
- `finishReadingSession(sessionId)` is idempotent and clamps duration to
  [0, 7200]s — a 2h cap against background-tab absurdity.

Everything else aggregates already-collected tables: `getAnalyticsOverview`
sums published-chapter counters for PV/finish, counts
favorites/subscriptions/readers/books, rounds finished-session seconds
into `totalDurationMin`, and takes 最近 7 天活跃 as distinct
`reading_progress.user_id` plus session count. `getBookFunnel` uses
chapter-1 PV (min 1) as baseline; retention = chapterPV / baseline; flags
are static rules — `drop-off` when retention falls ≥30 percentage points
vs the previous chapter, `low-finish` when finish rate <30% with PV ≥3 —
each surfaced as `flagReason`, the structured hook future AI analysis
consumes. `getBookChapterMetrics` projects the funnel rows for the admin
table.

Admin endpoints (all `requireAdmin`-gated; thin Next-15 shells over
`web/lib/analytics-handlers.ts`):

```
GET /api/admin/analytics/overview
GET /api/admin/analytics/books/[id]
GET /api/admin/analytics/books/[id]/chapters
```

The `/admin/analytics` page renders six overview cards, a book selector,
and a per-chapter table (retention/finish bars, flag highlighting),
wired into AdminShell nav as 数据分析.

Verification: test:analytics — 21 assertions covering session dedupe,
idempotent finish with the 2h clamp, overview aggregation, funnel
baseline retention math, both flag rules at their boundaries,
BOOK_NOT_FOUND, and the chapter-metrics projection. typecheck green.

## Alternatives considered

**A full page_views events table for every PV.** The shape discovery
signals explicitly deferred ("right for V8 analytics… add events then").
V8 kept that bargain: counters stay the O(1) fast path for PV/finish,
and the event table exists only where two timestamps are inherent.

**Client-only duration (localStorage + beacon batches).** Lost entirely
for anonymous readers and not joinable server-side to book/chapter;
server-side session rows keep duration queryable even though they are
anonymous.

**Third-party analytics (self-hosted umami/plausible).** Splits the data
the roadmap's AI analysis must read across systems; keeping rows in the
same SQLite the AI will query wins at this scale.

**Per-chapter UV now.** No anonymous identity exists to count; cookie-
based UV stays a documented non-goal exactly like PV dedupe there —
hence activeReaders7d proxies UV with registered readers only.

## Consequences

Gained: funnel and drop-off flags are pure SQL over already-collected
counters; reading time exists as queryable rows; admin has a live
surface; `flagReason` gives AI analysis structured input instead of raw
tables. Costs: sessions are anonymous, so "UV" is proxied rather than
measured; the 30s window is a heuristic (refreshing after >30s
double-counts); abandoned sessions (`finished_at IS NULL`) are excluded
from duration stats, undercounting time; the 2h cap silently truncates
outliers; and the drop-off thresholds (≥30pt relative fall, <30% finish
at PV ≥3) are static heuristics awaiting calibration from real AI
analysis.
