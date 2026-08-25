# Agent Note: Admin book and chapter management in Content Core

Status: implemented

English | [中文](2026-08-23-admin-book-chapter-management.zh.md)

## Problem

Before V2, content could only enter the system through the bulk importer
(`upsertBook`/`importChapter` are idempotent upserts keyed by slug/number).
There was no way to create a book explicitly (a colliding slug silently
overwrote the old book), edit one by id, take a novel offline while keeping
its data, or manage a single chapter's lifecycle (create with auto-numbering,
edit, unpublish, schedule, delete, reorder). `BOOK_STATUSES` had no hidden
state at all, so a "hidden" novel would still appear on every public page.

## Decision

`core/src/domain.ts` extends `BOOK_STATUSES` with `'hidden'`, adds a typed
`CoreError(code)` (`CoreErrorCode`: `BOOK_NOT_FOUND`, `SLUG_TAKEN`,
`CHAPTER_NOT_FOUND`, `CHAPTER_NUMBER_CONFLICT`, `INVALID_CHAPTER_ORDER`,
`INVALID_STATUS`) and admin input types (`CreateBookInput`,
`UpdateBookPatch`, `ListAllBooksOptions`, `CreateChapterInput`,
`UpdateChapterPatch`).

`core/src/service.ts` gains an admin section. Books: `createBook` (throws
`SLUG_TAKEN` on collision — unlike the importer's idempotent upsert),
`updateBook(id, patch)` (partial patch; provided `tags` rebuild the tag set),
`deleteBook` (transactional cascade over chapters and book_tags),
`listAllBooks` (no hidden filter, optional exact-status/category/q filters)
and `getAnyBookById`. Chapters: `listChapters` (all statuses),
`getChapterByNumber` (any status), `createChapter` (number defaults to
max+1; explicit collisions throw `CHAPTER_NUMBER_CONFLICT`; deleted numbers
are reusable), `updateChapter`, `deleteChapter`, and `reorderChapters`
(argument must be a permutation of existing numbers, else
`INVALID_CHAPTER_ORDER`; two-phase renumber — bump past the unique bound,
then place — avoids mid-transaction `UNIQUE(book_id, number)` conflicts).

Status-transition semantics in `updateChapter`: to `published` stamps
`publishedAt` once and never rewrites it on later edits; back to `draft`
cancels scheduling (`scheduledAt` cleared); to `hidden` keeps `publishedAt`
history; `scheduledAt` persists only while status is `scheduled` unless
explicitly provided.

Public visibility: every public surface — `listBooks`, `getBookBySlug`,
`getBookById`, `latestUpdates`, `rssItems`, and transitively `searchBooks`,
`featuredBook`, `getChapterView` — now excludes hidden books through the
shared `PUBLIC_BOOK_VISIBLE` predicate. Book slugs are immutable through the
admin path (URL/RSS/sitemap stability).

Verification: `npm run test:core` runs `scripts/verify-admin-core.ts`
against a temp-dir database (`NOVEL_DATA_DIR`), covering CRUD, hiding,
transition semantics, conflicts, reordering, and cascading deletes.

## Alternatives considered

**Editable slugs in `updateBook`.** Lost: slugs are embedded in public URLs,
RSS GUIDs, and sitemaps; renaming would break all inbound links for a benefit
the admin UI does not need yet.

**A single-chapter `move(bookId, from, to)` primitive.** Lost: arbitrary
moves still require shifting every chapter between `from` and `to`, so the
implementation is just as delicate, while whole-volume permutation is trivial
to validate ("must be a permutation") and expresses every reorder.

**Letting the admin/API layer execute SQL directly.** Lost: it would bypass
the unified visibility rules that make hiding correct everywhere; all reads
and writes go through the service layer.

**Soft delete (`deleted_at` column) instead of `deleteBook`.** Lost for V2:
hiding already covers taking a novel offline without losing data, and hard
delete matches the importer's idempotent model; revisit only if recycle-bin
behavior is ever requested.

## Consequences

Gained: the six V2 Content Management capabilities have a tested data layer;
hidden books disappear from every public surface at once; typed error codes
let the upcoming admin API map failures to HTTP semantics without string
matching. Cost: public query shapes changed (hidden filter) — any external
reader that cached book lists must tolerate disappearance; reordering
renumbers chapters and therefore changes chapter URLs, which is inherent to
调整顺序 but worth remembering when V3 scheduled publishing lands.
