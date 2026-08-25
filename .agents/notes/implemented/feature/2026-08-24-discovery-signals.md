# Agent Note: Discovery heat signals

Status: implemented

English | [中文](2026-08-24-discovery-signals.md)

## Problem

The roadmap §10 wants a Discovery homepage (今日推荐/热门/最新更新/新书/完结/猜
你喜欢) scored by 阅读量+更新频率+完读率+收藏 — but the platform recorded no
reading signals at all. Nothing counted views, finishes, or favorites as a
queryable metric.

## Decision

**Signals are three integer columns, not an events table:**

- `books.view_count` — book-level PV, incremented whenever a chapter page
  opens (anonymous included).
- `chapters.view_count` / `chapters.finish_count` — per-chapter PV and
  scroll-to-bottom completions; 完读率 = SUM(finish)/SUM(view) over
  published chapters, computed in SQL.
- favorites need no counter — `COUNT(*)` on the existing table.

Writes go through `trackChapterView` / `trackChapterFinish` in
`core/src/discovery.ts` (two single-row UPDATEs each; chapters must be
published, else CHAPTER_NOT_FOUND). Public endpoints:
`POST /api/books/[slug]/chapters/[n]/view|finish`, plus
`GET /api/books/[slug]/stats` returning `{viewCount, favoriteCount,
finishRate, publishedCount}` and `GET /api/discovery` for the feed.
Columns land via idempotent PRAGMA-checked migration (`migrateDiscoveryColumns`);
**ALTER TABLE must never go in the shared DDL template** — it re-executes on
every boot and would fail with duplicate column on existing databases.

Verification: test:discovery — 15 assertions: unpublished-chapter rejection,
PV aggregation across chapters, finish-rate bounds, stats 404, favorite
counting, section order today→hot→recent→new→completed, hot ranking puts a
6-PV book first, deduped 今日推荐, and logged-in 猜你喜欢 excluding
already-subscribed books. typecheck green.

## Alternatives considered

**Append-only events table (page_views).** Right shape for V8 analytics
(PV/UV/时长), wrong cost for V7 scoring — every feed query would aggregate
millions of rows. Counters are O(1) to read; if V8 needs history we add
events *then*, and counters remain the fast path (rebateable from events).
V8 kept exactly this bargain — see [analytics reading sessions]
(2026-08-24-analytics-reading-sessions.md).

**Server-side view tracking from the chapter RSC.** Server components can't
reliably count client navigations without double-counting prefetches;
explicit client POST keeps intent visible and lets us throttle/dedupe later.

**Anonymous-excluded signals.** Would gut 阅读量 for a reading site where
most readers never register; view counting is cheap and abuse-tolerant at
this scale.

## Consequences

Gained: the four roadmap inputs exist as queryable numbers; scoring (PR38)
is pure SQL + arithmetic. Costs: counters are lossy under replay/restore
(not transactional with backups of code that assumes exactness); repeated
client refreshes inflate PV (acceptable bias for ranking; dedupe via cookie/
IP is a documented non-goal until spam actually skews rankings); finish is
client-declared so it measures "reached bottom", not "read carefully".
