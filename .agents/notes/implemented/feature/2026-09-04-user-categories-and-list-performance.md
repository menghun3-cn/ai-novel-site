# Agent Note: User-facing category tiering, consistent counts, and faster list pages

Status: implemented

English | [中文](2026-09-04-user-categories-and-list-performance.zh.md)

## Problem

The reader-facing category experience had three defects. (1) Categories were a
flat pile with no tiering: there was no 长篇小说/短篇小说 split even though
books carry a `kind` column ('long'/'short'), and the category list did not ship
the mainstream genres a typical novel site is expected to show out of the box.
(2) Counts disagreed between the 全部小说 page and the category page:
`listCategories()` counted every book regardless of `status`, while
`listBooks()` only counted public books (`status <> 'hidden'`), so the sums
never matched. (3) Around 100 books, switching between 首页 / 全部小说 /
分类 felt visibly laggy: the book list ran six correlated subqueries per book
and every list page re-rendered server-side per request.

## Decision

Keep the `categories` table flat (`id`/`slug`/`name`) — no `kind`/`parent`
columns. Tiering is derived from the book's own `kind` at read time: the
category page groups into 长篇小说 (`longCount`) and 短篇小说 (`shortCount`),
and the 全部小说 / category detail pages add a client-side 长篇/短篇 tab.

- **Mainstream genre seed.** `core/src/db.ts` gains `DEFAULT_CATEGORIES`
  (~75 mainstream topics, deduplicated) seeded idempotently after migrations
  via `INSERT OR IGNORE` (inline slug logic, no import cycle). The seed
  deliberately excludes '短篇小说'/'长篇小说' so those names stay free for the
  short-story publication pipeline's `SHORT_STORY_DEFAULT_CATEGORY` and the
  verify scripts.
- **Consistent counts.** `listCategories()` now only counts public books
  (`LEFT JOIN books ... AND b.status <> 'hidden'`), returns `id` plus
  `count`/`longCount`/`shortCount` (camelCase aliases — snake_case aliases
  produced `NaN` on the JS side), and `countPublicBooks()` shares the exact
  filtering of `listBooks()`. The 全部小说 page's 「共 N 本」 uses the same
  numbers as the category chips.
- **List performance.** `BOOK_LIST_SQL` was rewritten from six correlated
  subqueries per book to grouped aggregates plus a `ROW_NUMBER() OVER
  (PARTITION BY book_id ORDER BY number DESC)` window to fetch the latest
  published chapter — two scans of `chapters` total. `FEED_SELECT` in
  `discovery.ts` got the same grouped-join rewrite (and now selects `b.kind`,
  which was previously missing at runtime). Reader list pages became ISR
  (`revalidate = 60`): the server fetches all books + category stats once, and
  `BooksBrowser` / `CategoryBrowser` client components filter entirely in the
  browser with zero server round-trips on tab/category switches. This was
  forced by a measured Next 15 behavior: a page that *reads* `searchParams`
  degrades to dynamic (`Cache-Control: no-store`) even with `export const
  revalidate`; the pages therefore do not read search params server-side and
  the client components read the initial `?category=`/`?kind=` via `useEffect`
  + `window.location.search` (not `useSearchParams`, which would client-side
  render the whole boundary). Card images across BookCard/DiscoveryCard/
  HotRanking/RecentUpdates/search got `loading="lazy" decoding="async"`.
- **Copy.** User-visible 朗读 was renamed to 听书 across TtsPlayer (button,
  engine options, error strings) and the tts API error message.
- **Default TTS engine → Kokoro.** The listen-back default engine became the
  local Kokoro engine when available (and no explicit user preference exists),
  falling back to `edge` otherwise; see the updated
  [local-kokoro-tts](../../implemented/feature/2026-09-03-local-kokoro-tts.md)
  note for the mobile 502 root cause and the switch logic.

## Alternatives considered

**Add `kind`/`parent` columns to `categories` (hierarchical category tree).**
Rejected: the flat table plus `book.kind` grouping delivers the same user
outcome with no schema migration, no dual-write of category ownership, and no
admin-UI ripple; categories stay a pure genre vocabulary.

**Keep server-side filtering driven by `searchParams` and rely on `revalidate`.
Rejected after production measurement: Next 15.5 degrades any page that reads
`searchParams` to dynamic regardless of `revalidate`, so every switch would
re-run SQL and re-render on the server — exactly the latency being fixed.

**Keep `edge` as the default listen-back engine.** Rejected: edge synthesis is
a long online POST (browser → /api/tts → server → bing WebSocket, seconds to
15s) that mobile network middle-layers (carrier transparent proxies / CDN edge
nodes) time out, answering 502 with a non-JSON error page — PC on broadband
direct connections is unaffected, which is why the same novel read fine on PC
but failed on mobile. Kokoro synthesizes locally in <1s with no external hop,
so it sidesteps the interception entirely.

## Consequences

- Category counts, the 全部小说 total, and the category page sums are now the
  same number everywhere (verified: 70 books = 3 long + 67 short).
- The 78-genre seed occupies the category namespace: `createCategory` for a
  seeded name now throws `CATEGORY_NAME_TAKEN`, so
  `verify-admin-core.ts` was adjusted to use a non-seeded name.
- List pages trade up-to-60s publication freshness (ISR window) for much lower
  latency; the home page stays `force-dynamic` for cookie personalization and
  still benefits from the `FEED_SELECT` rewrite.
- Client-side filtering requires JS; with JS disabled the /books and category
  pages still render the full static list (limit 500).
- `listCategories()` now returns `id`, which also fixed an admin category
  page bug that had called `/api/admin/categories/undefined` for rename/delete.
- Default listen-back engine is Kokoro when the image was built with
  `ENABLE_LOCAL_TTS=1` and the model is mounted; images without it silently
  use edge as before — no user-visible break either way.
