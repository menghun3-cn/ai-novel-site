# Agent Note: Pre-push Agent Note gate (local enforcement without CI)

Status: implemented

English | [中文](2026-09-03-pre-push-agent-notes-gate.zh.md)

## Problem

The Agent Notes rules (`.agents/notes/README.md` § When to write one) require
every non-trivial change to add or update an Agent Note in the same PR, but
the repository had **no mechanical enforcement**. The `doc-sync` gates
(`verify-agent-note-{classification,format}` and
`verify-archived-agent-notes`) only validate notes that already exist — they
never fail when a change should have carried a note but did not. There were no
git hooks, no CI workflow, and GitHub Actions was deliberately deferred, so
the rule was paper-only: it fired only when an agent or reviewer happened to
read the README before committing. The v8.2.1 production-line UI change
shipped without its note (backfilled afterwards in #103/#104), demonstrating
the gap.

## Decision

Add a **shared local pre-push hook** that enforces both halves mechanically:

- `.githooks/pre-push` — a thin `sh` wrapper; hooks live in-repo under
  `.githooks/` and are activated per-clone via `core.hooksPath` (set
  automatically by the root `package.json` `prepare` script,
  `git config core.hooksPath .githooks`).
- `scripts/hooks/verify-push-notes.mjs` — zero-dependency Node gate that:
  1. Reads the pre-push stdin ref lines (`<local ref> <local sha> <remote ref>
     <remote sha>`), skips deletions and tags, and computes the changed-file
     set with `git diff --name-only <base> <local>` (base = remote SHA, or
     `merge-base` with `origin/master` for new branches).
  2. Classifies files as non-trivial vs trivial: `*.md` (docs),
     `package.json`/lockfiles/`.gitignore` etc. are trivial; notes themselves
     (`.agents/notes/{proposed,implemented,rejected}/`) count as carrying a
     note. Any other file (code, config, scripts) is non-trivial.
  3. If non-trivial files exist but no notes file changed in the same push,
     prints the offending files and exits 1 — **blocking the push**.
  4. Otherwise runs `pnpm run doc-sync` and blocks the push if the notes tree
     is not fully green.

## Alternatives considered

**GitHub Actions workflow as a status check.** The only truly server-side,
non-bypassable option on plain GitHub, and the long-term answer — but
explicitly deferred by the team. Pre-push remains the local backstop until
then.

**Server-side `pre-receive` hook.** Not available on github.com hosting
(requires GitHub Enterprise); rejected for that reason.

**Copy hooks into `.git/hooks`.** Works for one checkout but does not travel
with clones; `core.hooksPath` pointing at a tracked `.githooks/` directory
distributes the gate with the repository instead.

**Husky / lint-staged.** Adds a dependency and config surface for what one
small Node script plus a sh wrapper already does; rejected as over-tooling.

## Consequences

- Every contributor who runs `pnpm install` (or sets `core.hooksPath` once)
  is blocked at push time when a non-trivial change lacks a note, and when
  the notes tree fails `doc-sync` — the rule now fires mechanically.
- The gate is **local and bypassable**: an un-hooked clone or
  `git push --no-verify` escapes it. It is a team-convention backstop, not a
  fortress; the README documents this limit explicitly.
- Non-trivial classification is intentionally coarse (any non-doc,
  non-package.json file). A dependency bump inside `package.json` does not
  force a note even though it can be non-trivial; acceptable for v1, and the
  gate errs toward not blocking routine pushes.
- Push latency increases by the `doc-sync` runtime (~a few seconds).
