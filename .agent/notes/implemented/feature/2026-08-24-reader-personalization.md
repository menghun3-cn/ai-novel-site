# Agent Note: Reader personalization (favorites, subscriptions, progress)

Status: implemented

English | [中文](2026-08-24-reader-personalization.md)

## Problem

Readers could exist but nothing to personalize: the roadmap §9 items —
我的书架(阅读至第N章/进度%)、阅读历史、收藏、订阅+新章节提示 — had no
storage, service, or endpoints. Client-side localStorage progress from V2
could not follow an account across devices.

## Decision

Three tables keyed by composite `(user_id, book_id)` with CASCADE:

- **favorites** — pure toggle set.
- **subscriptions** — adds `last_seen_chapter` (monotonic: `MAX(existing,
  n)` on every progress report), so reading an OLD chapter never clears a
  new-chapter flag.
- **reading_progress** — upsert of `{chapter_number, percent}`; percent
  clamped 0-100; chapter must be **published** or CHAPTER_NOT_FOUND.

Service layer in reader.ts: `toggleFavorite/toggleSubscription` return the
post-toggle boolean; `getReaderShelf` joins favorites ∪ subscriptions with
published-chapter counts and latest progress, computing
`hasUpdate = publishedCount > max(progressChapter, 0)` and ordering by
recency; `getReadingHistory` is a recency-ordered projection.

Endpoints (all cookie-authenticated, 401 `UNAUTHENTICATED` when anonymous;
unknown slug → 404 `BOOK_NOT_FOUND`; CoreErrors flow through shared
handleError):

```
GET|POST /api/books/[slug]/favorite     GET|POST /api/books/[slug]/subscribe
POST     /api/books/[slug]/chapters/[n]/progress   {percent?}
GET      /api/me/shelf                 GET /api/me/history?limit=
```

Route files are thin Next-15 shells delegating to `web/lib/reader-handlers.ts`
so the logic is directly testable without HTTP.

Verification: test:reader grew to 26 assertions (toggle idempotency,
unpublished-chapter rejection, progress keeps most-recent report even when
re-reading older chapters, hasUpdate flips true→false after catching up,
shelf retains favorites after unsubscribe and empties when both removed),
test:reader-api to 31 (401 gates, state-vs-toggle semantics, 404s, shelf
and history payloads). typecheck + full build green.

## Alternatives considered

**Single JSON blob per user.** Loses per-book indexing and makes the shelf
JOIN awkward; three narrow tables keep queries trivial and future features
(download counts, recommendation signals) separable.

**Percent as float.** Rounded to int at the boundary — display granularity
is whole percent; avoids float noise in comparisons.

**Separate "read later" from favorites.** Roadmap only asks 收藏; merging
concepts until a real need appears.

## Consequences

Gained: server-side identity-bound reading state, the substrate PR34's UI
needs. Costs: shelf recomputes published counts via correlated subquery per
book — fine at current scale, becomes a materialized counter if catalogs
grow large; unsubscribing keeps progress rows (intentional — history
survives), so user data cleanup needs the CASCADE-on-account-delete path.
