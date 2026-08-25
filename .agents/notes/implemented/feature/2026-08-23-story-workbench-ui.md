# Agent Note: Story workbench UI

Status: implemented

English | [中文](2026-08-23-story-workbench-ui.md)

## Problem

V4's data layer, context assembler, and AI writer were API-only: worldview,
characters, arcs, outlines, and foreshadowing were invisible without curl,
and generation required hand-built HTTP requests. The loop closed only in a
terminal.

## Decision

One page, `/admin/story` (**AI 创作中心**, new sidebar entry with the
Sparkles icon): pick a book from the top selector, then stacked cards —
世界观与写作规则 (two textareas + save), 人物 (table with role badges +
add/edit modal + delete confirm), 人物关系 (inline add row), 故事线
(status badges + modal), 章节大纲 (per-number upsert modal, beats as one
beat per line), 伏笔 (plant modal / resolve-with-chapter modal reusing the
idempotent COALESCE semantics / delete), and the AI 工作台 card.

The workbench shows the target chapter number (`MAX(number)+1` computed from
the chapters list, matching engine default), an optional instructions box,
two switches — 质检通过后自动送审 (default on) and LLM 编辑复核 (default
off) — and renders generation outcomes precisely: created → chapter number/
title/char count plus 送审/暂扣/草稿 disposition; QC-rejected → `created:false`
with issue codes listed, nothing written. Success dispatches
`admin:review-changed` so the review badge updates instantly.

Backing endpoints consolidate to seven routes under
`/api/admin/books/[id]/story/*` (bundle GET, world PUT, characters
POST/DELETE with `characterId` for rename-updates, relationships, arcs
POST/PUT/DELETE, outlines PUT-by-number/DELETE, foreshadowing POST/PUT-resolve/DELETE).
All reuse core services directly; error codes map through the existing
exhaustive `STATUS_BY_CODE`.

Verification follows the established CDP protocol against a **mock LLM
upstream** (local http server speaking chat-completions, wired via
`AI_BASE_URL/AI_API_KEY/AI_MODEL`): 20 assertions covering nav entry, form
prefill, every table/badge, target number, a real click-through generate →
draft → auto-submit → badge increment, add-character modal round-trip,
delete-confirm cancel path, and 375px drawer/no-overflow. typecheck and
production build pass. One audit iteration was needed: React controlled
inputs require native value setters in CDP scripts.

## Alternatives considered

**Per-book tabs inside the existing book detail page.** Lost: story facts
belong to a different workflow (authoring setup vs publishing ops); merging
them would make the already-dense detail page worse for both tasks.

**Separate pages per entity** (characters page, outlines page…). Lost:
setting up a book is one continuous task over small related sets; six page
hops per book would be hostile at typical scale (<20 rows each).

**Optimistic UI for mutations.** Rejected again for state-changing ops:
reload-through-API after each mutation keeps tables equal to server truth;
latency is imperceptible on SQLite.

## Consequences

Gained: the full V4 loop — define world/people/plots → generate with
guardrails → land in V3 review queue — is operable from the browser end to
end. Cost: single-book-per-visit selection resets on reload (no URL param
for the selected book yet); the workbench trusts client-side `MAX+1` for
display while the server recomputes authoritatively, so a stale tab may show
a wrong target number until next load; both are cheap follow-ups if they
bite.
