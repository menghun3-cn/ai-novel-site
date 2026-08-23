# Agent Note: AI Writer engine

Status: implemented

English | [中文](2026-08-23-ai-writer-engine.zh.md)

## Problem

Story Core stores facts and the context assembler renders prompts, but
nothing talks to an LLM or turns its output into a governed chapter. The gap:
provider plumbing, quality gating before anything touches Content Core, and a
path into V3's review workflow ([related](2026-08-23-review-console-ui.md))
rather than straight to published.

## Decision

`core/src/ai-writer.ts`, four pieces:

1. **Provider abstraction** — `LlmProvider.complete()` plus one concrete
   adapter, `createOpenAiCompatibleProvider` (chat-completions over fetch,
   works with DeepSeek/OpenAI/local gateways). Config comes from env
   (`AI_BASE_URL/AI_API_KEY/AI_MODEL`) via `resolveProviderFromEnv`; missing
   vars raise `AI_NOT_CONFIGURED` (mapped 503), upstream failures become
   `AI_PROVIDER_FAILED` (502). Tests use `createFakeProvider` and a local
   http server — no real network in CI.
2. **Rule QC first** — `qualityCheckChapter()` is a pure function with three
   gates: minimum length (default 500 chars), AI self-reference markers
   (`/作为(一个)?AI|语言模型|…/`), and sliding-window repetition (60-char
   windows at half-step, ≥4 identical → fail). A failed gate means **no
   chapter row is created at all**; the API result carries `created:false`
   plus issue codes for operator display.
3. **Optional LLM review** — `llmReviewChapter()` asks a second completion to
   act as editor; first line must be PASS/FAIL. On FAIL the chapter is still
   written as draft but auto-submit is withheld and the reason is stored in
   the chapter's `review_note` prefixed `LLM 复核暂扣:` — reusing V3's field,
   so the hold shows up in existing UI.
4. **Landing through the state machine** — success path is strictly
   `createChapter(draft)` then optionally `submitChapterForReview`; title is
   extracted from the model's first `# ` heading (stripped from body to avoid
   duplication) with outline-title fallback. Target-chapter conflicts surface
   as `CHAPTER_NUMBER_CONFLICT` from the assembler.

Endpoint: `POST /api/admin/ai/generate-chapter`
(`{bookId, chapterNumber?, instructions?, submitForReview?, llmReview?}`),
static route annotated `withAdmin<AdminRouteContext>` — the Next15 zero-arg
generic trap from PR#3 again.

Verification: `npm run test:ai-writer` (engine: QC rules, env guard, mock
server round-trip, submit/hold/conflict/failure paths) and
`npm run test:ai-api` (endpoint: 503 unconfigured, 400 validation, 200
created+submitted, 502 upstream). Both run against temp databases.

## Alternatives considered

**Write chapters directly as pending_review in one insert.** Lost: it would
bypass the V3 transition guards and make "draft exists but never reviewed"
unrepresentable; two steps reuse audited code.

**Auto-retry generation on QC failure.** Deferred: silent retries multiply
cost and hide prompt problems; surfacing `created:false` with codes lets the
operator adjust instructions deliberately. Retry belongs in V5's pipeline
with budgets.

**Hard-code one vendor SDK.** Lost: the OpenAI-compatible shape covers every
backend this project might use; a single adapter keeps the dependency surface
at zero (plain fetch).

## Consequences

Gained: chapter production with a hard quality floor and a human review
gate by default (`submitForReview:false` leaves drafts; UI opts in).
Cost: QC heuristics are crude — length/markers/repetition catch the worst
failures but say nothing about plot coherence, which remains the LLM review's
judgment call; also generation holds no lock, so concurrent generates for the
same book race on `MAX(number)+1` and one will lose with
CHAPTER_NUMBER_CONFLICT — acceptable for single-operator use, needs a queue
in V5.
