# Agent Note: Admin author, category, and tag management in Content Core

Status: implemented

English | [中文](2026-08-23-admin-author-category-tag-management.zh.md)

## Problem

The importer creates authors/categories/tags implicitly through
`upsertAuthor`/`upsertCategory`/`upsertTag`, which only insert and never
update: an author has nothing but a name (no bio, no avatar per the roadmap's
作者管理), a mistyped category or tag name cannot be fixed without SQL, and
nothing can ever be deleted. The V2 admin needs real management for all three
entities ([related: book and chapter management](../feature/2026-08-23-admin-book-chapter-management.md)).

## Decision

Schema (`core/src/db.ts`): `authors` gains `bio TEXT` and `avatar_path TEXT`.
Fresh databases get them from the DDL; existing ones are migrated
idempotently by `migrateAuthorColumns()`, which checks `PRAGMA
table_info(authors)` and issues `ALTER TABLE ADD COLUMN` only for missing
columns.

Service (`core/src/service.ts`): authors — `listAuthors()` (each with
`bookCount`, descending), `getAuthor`, `updateAuthor(id, patch)` (name/
bio/avatarPath; a clashing name throws `AUTHOR_NAME_TAKEN`), `deleteAuthor`
(`AUTHOR_IN_USE` while any book references the author). Categories —
`createCategory(name)` (`CATEGORY_NAME_TAKEN` on name-or-slug collision),
`updateCategory(id, patch)` rename, `deleteCategory` (`CATEGORY_IN_USE`
while referenced). Tags — `createTag`, `getTag`, `updateTag`, `deleteTag`
(which removes `book_tags` rows inside a transaction; `TAG_NAME_TAKEN`,
`TAG_NOT_FOUND`). New `CoreErrorCode` values: `AUTHOR_NOT_FOUND`,
`AUTHOR_NAME_TAKEN`, `AUTHOR_IN_USE`, `CATEGORY_NOT_FOUND`,
`CATEGORY_NAME_TAKEN`, `CATEGORY_IN_USE`, `TAG_NOT_FOUND`, `TAG_NAME_TAKEN`.
`Author` carries optional `bio`/`avatarPath`; `AuthorWithCount` adds
`bookCount`.

Renaming a category or tag never regenerates its slug — slugs are derived
once at creation and stay immutable (category slugs are public URL segments;
tags follow the same rule for consistency).

Verification: `npm run test:core` extends its temp-db scenario with author
bio/avatar updates, counts, rename clashes, in-use deletion guards,
order-of-operations (delete the referencing book first), and tag cascade
deletion — all green alongside typecheck.

## Alternatives considered

**`ON DELETE CASCADE` foreign keys instead of explicit guards.** Lost:
accidentally cascading an author's whole bibliography away with one delete
call is catastrophic; an explicit `*_IN_USE` error forces the admin to move
or delete books consciously.

**Regenerate slugs on rename.** Lost: `/categories/[slug]` routes and any
future tag pages would break; a renamed entity keeps its identity.

**Full media records for avatars/covers now.** Deferred: media management is
its own roadmap item; author bio/avatar store plain path strings until that
PR lands.

## Consequences

Gained: three of the six V2 Content Management modules have a complete,
tested data layer; typed error codes keep the upcoming admin API mechanical.
Cost: schema evolution now has two sources of truth (DDL for fresh,
`migrateAuthorColumns` for existing) that must be kept aligned, and renames
leave stale display names in already-rendered caches/RSS until regenerated —
acceptable because all public pages render from the live database.
