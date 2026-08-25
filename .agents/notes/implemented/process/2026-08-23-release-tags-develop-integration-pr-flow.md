# Agent Note: Release tags, develop integration, and PR-per-change flow

Status: implemented

English | [中文](2026-08-23-release-tags-develop-integration-pr-flow.zh.md)

## Problem

V1 is complete and tagged, but the roadmap (`docs/AI原创内容创作平台.md`)
defines many more milestones (V2 Content Management, V3 Publishing Core, V4
Story Core + AI Writer, …), each containing several independently reviewable
changes. Developing directly on `master` would smear every milestone into one
unreviewable line, leave no rollback point at milestone boundaries, and let
agent rounds couple unrelated features. The repository needed an explicit
branching and merge discipline before the first V2 change landed.

## Decision

`master` is the release line: it only ever receives `--no-ff` merge commits
from `develop` at milestone boundaries, and every release merge is tagged
`vN.M.0` (annotated). `v1.0.0` marks the completed V1 content baseline
(MD/TXT import, Content Core, Web Publisher, RSS, SEO). `develop` is the
standing integration branch for the current milestone.

Every development item — feature, fix, or chore — is built on its own branch
(`feat|fix|chore/<topic>`) cut from `develop`, and lands only through a merge
commit whose message names the change as a numbered PR (`PR #N: <topic>`).
Direct work commits on `master` or `develop` are forbidden. Branches are
pushed to `origin`; since the `gh` CLI (v2.98.0) became available,
authenticated through a `GH_PAT` environment variable mapped onto
`GH_TOKEN`, PRs are opened for real (`gh pr create --base develop`) and
landed with `gh pr merge --merge`, so GitHub records the reviewable PR and
the merge commit. PRs #1–#2 predate gh availability and were merged locally
with `--no-ff` — topologically identical to GitHub merge commits.

## Alternatives considered

**GitHub flow (every PR straight into `master`).** Lost for now:
milestone-scale work needs a visible integration point where V2 features
accumulate before the release merge; merging each feature straight to the
release line would create tag-or-not ambiguity at milestone boundaries.

**Continue committing to `master` directly.** Lost: no clean `v1.0.0`-style
rollback points, no per-change review or revert boundary, and unrelated agent
rounds would interleave inside single milestones.

## Consequences

Gained: `v1.0.0` permanently identifies the V1 baseline; every change is an
isolated, revertable merge with a PR number; milestone completion is an
explicit, taggable event (`develop` → `master` → `v2.0.0`). Cost: merge
commits and branch overhead per change, and `develop` can drift from
`master` between releases — acceptable at this project's change volume, and
the release merge is the explicit reconciliation point.
