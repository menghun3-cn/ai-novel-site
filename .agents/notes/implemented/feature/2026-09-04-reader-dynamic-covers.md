# Agent Note: Reader-facing dynamic book covers by genre

Status: implemented

English | [中文](2026-09-04-reader-dynamic-covers.zh.md)

## Problem

Books without an uploaded cover (`coverPath` is null — every AI-generated
short story, and any long book the operator never gave art) fell back to a
plain first-character placeholder across the reader site. On a home page /
全部小说 / search / hot list filled with such books, the entire row of cards
looked like a wall of gray squares: monotonous, and it gave the reader zero
genre signal before opening a book. The reference cover design (300×400,
spine + watercolor + vertical title + status pill + bookmark) proved the
"book object" metaphor works, but one fixed palette for everything would just
move the monotony into a different shape.

## Decision

Add a dependency-free, server-side SVG cover generator and route it in as the
fallback for every reader-side cover slot:

- **`web/lib/cover-svg.ts`** — pure string builder (no framework imports, so
  the verify script can import it directly). It keeps the reference "book"
  skeleton (spine with AI + genre chars, cover, page-edge texture, bookmark,
  drop shadow) and varies **palette, decorative motif, font, and title layout
  per genre**: heal / scifi / xianxia / mystery / romance / urban / campus /
  history / adventure / default, matched by keyword against the book's
  category (fallback = default). Pure-CJK titles render vertically (up to 10
  chars with automatic font-size scaling, centered to stay above the status
  pill); titles with latin/digits render horizontally with word-aware
  wrapping. Author, status pill (短篇/连载中/完结), and the
  `分类短篇 · 共N章` footer follow the reference layout. All text is
  XML-escaped.
- **48×48 icon variant** (`renderCoverIconSvg`) for list rows — 最新更新 and
  热门小说 rank rows render a compact rounded plate + spine + watercolor
  blobs + a small per-genre motif + genre label, instead of shrinking the
  full 300×400 cover into an illegible thumbnail.
- **`web/app/api/covers/[slug]/route.ts`** — serves `image/svg+xml` with the
  media-route CSP (`default-src 'none'; style-src 'unsafe-inline'; sandbox`)
  and `public, max-age=3600, stale-while-revalidate=86400`. If the book has a
  real cover, it 307-redirects to it (uploaded art stays canonical); hidden or
  missing books 404 (same public-visibility rule as every reader query).
  `?s=icon` selects the 48×48 variant.
- **Wiring.** `coverSrc`/`coverIconSrc` helpers normalize `coverPath` (leading
  slash preserved, relative gets one) and fall back to the API route. Applied
  to BookCard, DiscoveryCard, HotRanking (rank rows use the icon variant, the
  #1 featured card keeps the full cover), RecentUpdates (icon), home hero,
  book detail, and search results — replacing every letter placeholder.
- **`scripts/verify-cover.ts`** (`npm run test:cover`) — asserts theme
  selection per category, SVG structure, XML escaping, URL fallbacks, and
  route behavior (200 / `?s=icon` / 307 redirect / 404 for missing and
  hidden).

## Alternatives considered

**Keep the letter placeholder.** Rejected: it is the exact monotony being
fixed and carries no genre information; a themed cover doubles as a browsing
signal.

**Pre-generate static SVG files per category at build time.** Rejected: the
cover must reflect live book state (status pill, chapter count, author), so a
static catalog would go stale or force a rebuild per publication; runtime
generation keeps a single source of truth with zero deploy coupling.

**Always generate, ignoring `coverPath`.** Rejected: operator-uploaded art is
the higher-quality canonical cover; the route redirects to it so existing
artwork keeps winning.

**Generate on the client (canvas/JS).** Rejected: server-side SVG is
cacheable, CSP-sandboxable, dependency-free, and works with JS disabled.

**Put the generator in `core/src/`.** Rejected in favor of `web/lib/`: this
is reader-site presentation, and keeping it in web keeps core free of
presentation concerns while staying importable by the verify script.

## Consequences

- Every no-cover book now gets a genre-consistent, book-shaped cover on all
  reader surfaces; the genre theme is keyed off `categoryName`.
- AI-generated short stories publish with the fixed category 短篇小说, which
  matches no theme keyword → they land on the neutral default theme. Making
  them follow the story brief's genre would require a behavior change in
  `core/src/short-story-publication.ts` (category from `brief.genre`) and is
  deliberately out of scope.
- The cover route is `force-dynamic` with a 1-hour cache; covers age at most
  by the cache window after a status/chapter change.
- `test:cover` joins the verify suite; the cover generator has no runtime
  dependencies, so it cannot drag in build-order issues.
