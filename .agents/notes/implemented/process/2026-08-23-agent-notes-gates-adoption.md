# Agent Note: Agent Notes tree and gates adoption

Status: implemented

English | [中文](2026-08-23-agent-notes-gates-adoption.zh.md)

## Problem

Starting with the V2 iteration, this repository is developed in many rounds by
AI agents against a multi-milestone roadmap (`docs/AI原创内容创作平台.md`).
Code, commit messages, and prose docs cannot carry the *why* and the *rejected
alternatives* behind non-trivial changes; without a durable home for them,
rationale lives in chat transcripts and every new round re-litigates settled
decisions. The project also needs mechanically checkable guarantees that such
records stay well-formed, classified, bilingual, and never silently rewritten.

## Decision

Decision records live in `.agents/notes/` as **Agent Notes** — RFC-style notes
governed by [.agents/notes/README.md](../../../.agents/notes/README.md). Every
non-trivial change adds or updates at least one Agent Note in the same PR.
Notes move between `proposed/`, `implemented/`, and `rejected/`; fully retired
implemented notes are frozen under `archived/`.

Three gates enforce the standard and are wired into package.json:

- `npm run verify-agent-note-format` (`scripts/verify-agent-note-format.ts`) —
  header grammar (`# Agent Note: <title>` / blank / `Status: <status>` /
  blank), lifecycle-specific required sections, mandatory
  `## Alternatives considered`, ban on proposal-era headings inside
  implemented notes.
- `npm run verify-agent-note-classification`
  (`scripts/verify-agent-note-classification.ts`) — closed lifecycle/class
  folder sets and dated filenames, via the shared walker
  `scripts/agent-note-tree.ts`.
- `npm run verify-archived-agent-notes`
  (`scripts/verify-archived-agent-notes.ts`, helper
  `scripts/archived-agent-notes.ts` with `archived-agent-notes.spec.ts`) —
  validates and append-seals the frozen `archived/` manifest.

`npm run check:notes` runs all three in sequence.

Each note is a trilingual-consistent triplet: English `.md`, Chinese `.zh.md`
counterpart with identical structure (header tokens stay English), and an
`.i18n.yaml` companion recording the git blob hashes of both sides at the last
confirmed-consistent state.

## Alternatives considered

**Free-form RFCs under `docs/`.** No mechanical gates, so structure and
lifecycle rot within weeks; rejected because the whole point is enforceability.

**A centralized INDEX.md / ADR table.** Forbidden by the Agent Note rules:
indexes duplicate state and drift from the files they list; browsing happens
through the lifecycle/class tree and repository search.

**Git history as the only decision record.** Git records *what* changed but
not the alternatives weighed or the conditions to reintroduce them; chat
transcripts are not durable or reviewable in-repo.

## Consequences

Gained: rationale, alternatives, and verification requirements survive across
agent rounds; supersession and archiving are machine-checkable instead of
best-effort. Cost: every non-trivial PR carries documentation overhead — two
language versions plus a hash record per note — which is real but bounded
work compared with re-deriving lost decisions.
