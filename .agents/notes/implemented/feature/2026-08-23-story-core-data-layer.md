# Agent Note: Story Core data layer

Status: implemented

English | [中文](2026-08-23-story-core-data-layer.zh.md)

## Problem

The V4 AI content engine needs a place to keep **story facts** separate from
published content: worldview, characters and their current state,
relationships, story arcs, per-chapter outlines, and foreshadowing. Content
Core (`books`/`chapters`) is the wrong home — chapters are publishable
artifacts while these are long-lived constraints that every future generation
must respect ([roadmap](../../../docs/AI原创内容创作平台.md) §6).

## Decision

New `core/src/story.ts` service module over six new tables in `db.ts`
(`story_worlds`, `story_characters`, `story_relationships`, `story_arcs`,
`story_outlines`, `story_foreshadowing`), all keyed by `book_id` and created
via `CREATE TABLE IF NOT EXISTS` inside the existing DDL — no migration step
needed for existing databases because DDL re-runs on every open.

Semantics worth recording:

- **World**: one row per book; reads return a *virtual* empty world when the
  row does not exist yet, so callers never branch on existence.
- **Characters**: `(book_id, name)` UNIQUE with upsert-by-name semantics —
  re-submitting a name updates instead of duplicating; renaming into an
  existing name raises `CHARACTER_NAME_TAKEN`. Roles are a closed union
  (`protagonist/antagonist/supporting/minor`) guarded by `isCharacterRole`.
- **Arcs**: status closed union (`planned/active/done`), partial-update merge.
- **Outlines**: upsert by `(book_id, number)` via `ON CONFLICT DO UPDATE`.
- **Foreshadowing**: `resolveForeshadowing` writes the resolving chapter with
  `COALESCE(resolved_chapter, ?)` so double-resolution is idempotent and keeps
  the first resolving chapter; `openOnly` filters unpaid ones for prompt
  assembly later.

Every function asserts the book exists first (`BOOK_NOT_FOUND`), keeping
orphan story facts impossible through the service layer. Six new
`CoreErrorCode`s were added; web's exhaustive `STATUS_BY_CODE` record forced
the API mapping in the same commit — the exhaustiveness check did its job.

Verification: `scripts/verify-story-core.ts` (`npm run test:story`, ~28
assertions) covers virtual-world default, upsert-vs-duplicate characters,
cross-book same-name isolation, arc status guard, outline idempotency, and
foreshadowing resolve-idempotency against a temp database.

## Alternatives considered

**One generic JSON blob per book** (`settings` column on `books`). Lost: no
per-entity identity for updates/deletes, no referential queries ("which arcs
are active"), and prompt assembly would parse free-form JSON every time.

**Separate SQLite tables per entity but no book-existence assertion.** Lost:
service-level writes could orphan facts after a book delete; the assert makes
every entry point safe by construction.

**UUIDs for characters/arcs/outlines.** Kept integer AUTOINCREMENT: entities
are always addressed within a book scope, integers keep URLs short, and
uniqueness is enforced by natural keys (`book_id,name` / `book_id,number`)
rather than random ids.

## Consequences

Gained: a typed, tested fact store that PR#14's context assembler can read
without touching chapter publishing logic. Cost: relationship endpoints are
free-text names, not FK-enforced character ids — renaming a character will
not rewrite relationships, acceptable now because renames are rare and the
relationship list is advisory context for prompts, not an invariant source;
strict graph integrity belongs to V5 if automated pipelines demand it.
