# Agent Note: Discovery homepage

Status: implemented

English | [中文](2026-08-24-discovery-homepage.md)

## Problem

The homepage was still V2-era: a hardcoded featuredBook() hero, a flat
最新更新 list, and a 小说库 grid. None of §10's boards existed, and nothing
recalled a returning reader's position.

## Decision

The homepage is now a server component driven entirely by
`getDiscoveryFeed(userId)`:

- **今日推荐 hero** — today's top item as the big card (title/category/
  chapter count/description + 开始阅读).
- **继续阅读** — only for logged-in readers with history; rows link
  straight to 第N章 · P%.
- **热门小说 / 最新更新 / 新书推荐 / 完结好书 / 猜你喜欢** — each board is
  a titled DiscoveryCard grid (per-board column layout); empty boards
  collapse silently. 猜你喜欢 renders only when a session cookie resolves;
  cards carry the category name as a 推荐理由 badge. An empty catalog gets
  a single friendly pointer to /books.

Identity comes from reading `reader_session` via `cookies()` (awaited —
Next 15 returns a Promise) and resolving through getSessionReader inside
try/catch; anonymous visitors simply get no 继续阅读 and no 猜你喜欢.
Everything stays server-rendered — one feed call plus one history query per
request, no client fetch waterfall.

Verification: clean-room CDP audit 8/8 on a fresh DB seeded with three
books of differing heat (hot serializing ×3ch, stale serializing, completed):
hero = 热门之书; all expected boards present and 匿名无猜你喜欢; after
opening chapter 1 three times the hot board's first card flips to that
book (PV → ranking wiring proven in-browser); logged-in home gains 猜你喜
欢; after reading + favoriting a sci-fi book the homepage shows 继续阅读
with 第1章 and a populated 猜你喜欢. typecheck + build green.

## Alternatives considered

**Client-side feed fetch with skeleton states.** Worse LCP and an extra
round-trip for content that changes at most per request anyway.

**Personalized hero (from 猜你喜欢).** Roadmap keeps 今日推荐 as the editorial
top slot; personalization lives one board down where it's honest about
being algorithmic.

**Keep featuredBook().** Its "latest published book" heuristic is now
strictly dominated by today's scored pick; removed from the homepage (the
function remains for API compat).

## Consequences

Gained: the §10 homepage end-to-end — signals recorded in PR37/38 now rank
what readers see, and returning readers get recalled first thing. Costs:
homepage is fully dynamic and uncacheable per-user (fine at this scale;
CDN caching would need the anonymous variant split out); feed recomputes
scores per request over the whole published catalog — the same correlated-
subquery caveat as the shelf, revisit with materialized counters if
catalogs reach thousands.
