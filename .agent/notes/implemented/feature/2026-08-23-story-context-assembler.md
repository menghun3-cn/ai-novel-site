# Agent Note: Generation context assembler

Status: implemented

English | [中文](2026-08-23-story-context-assembler.zh.md)

## Problem

The roadmap's core insight ([§7](../../../docs/AI原创内容创作平台.md)): naive
"AI writes chapter 50" drifts — personalities shift, world rules conflict,
foreshadowing is forgotten. The AI writer must first *see* worldview, character
states, active arcs, unpaid foreshadowing, recent chapters, and the target
chapter's outline. Nothing in the repo assembled that view.

## Decision

`core/src/story-context.ts` provides two pure-read functions:

- `getGenerationContext(bookId, opts)` returns a `GenerationContext`:
  world, characters (+current state), relationships, **non-done** arcs,
  **open-only** foreshadowing, recent chapter excerpts (tail-truncated to 600
  chars by default, oldest→newest), `nextChapterNumber` (default
  `MAX(number)+1`, or explicit), and the outline row for that number if any.
  Guards: unknown book → `BOOK_NOT_FOUND`; an explicitly requested chapter
  that already exists → `CHAPTER_NUMBER_CONFLICT` — generation targets the
  next chapter or a reserved outline slot, never overwrites prose.
- `renderGenerationPrompt(ctx)` renders a deterministic Markdown prompt with
  fixed section order (`# 任务 / 世界观与写作规则 / 人物 / 人物关系 / 故事线 /
  未回收伏笔 / 最近章节 / 第 N 章大纲`); empty sections are skipped. With an
  outline the prompt says 要点必须全覆盖; without one it instructs natural
  continuation. Byte-for-byte determinism is asserted in tests so prompt
  regressions are diffable.

Excerpting keeps only each recent chapter's tail: endings carry continuity
(forward hooks) while costing bounded tokens regardless of chapter length.
Verification lives in `scripts/verify-story-context.ts`
(`npm run test:story-context`, 24 assertions) covering the empty-book default,
number derivation, conflict guard, done/open filtering, truncation length,
and render determinism.

## Alternatives considered

**Summarize older chapters via LLM at assembly time.** Deferred: summaries
would make prompts non-deterministic and every generation pay latency for
re-deriving stable facts; tail excerpts are free and stable. A cached
summary layer can slot in later without changing `GenerationContext`.

**Assemble inside the future AI-writer module.** Lost: separation lets PR#15's
engine stay provider/prompt-mechanics-only, and admin UIs or debug endpoints
can inspect exactly what the model will see without invoking any LLM.

**Include all foreshadowing with resolved markers.** Lost: resolved items are
noise for the next-chapter task; `openOnly` was already built in PR#13.

## Consequences

Gained: one tested seam between Story Core facts and any consumer; PR#15
feeds `renderGenerationPrompt` output straight to its provider adapter.
Cost: excerpt tails ignore mid-chapter callbacks to old setups — long-range
continuity still depends on outlines/foreshadowing records being maintained;
also `nextChapterNumber` counts chapters of any status, so a draft occupying
the next slot must be cleared before regeneration (deliberate: it surfaces
as CHAPTER_NUMBER_CONFLICT rather than silently duplicating).
