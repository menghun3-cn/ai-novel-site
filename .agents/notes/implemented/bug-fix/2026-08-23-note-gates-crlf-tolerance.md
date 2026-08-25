# Agent Note: Note gates CRLF tolerance and LF-pinned checkout

Status: implemented

English | [中文](2026-08-23-note-gates-crlf-tolerance.zh.md)

## Problem

On Windows with `core.autocrlf=true`, every branch switch rewrote tracked
Agent Notes and gate scripts to CRLF in the working tree. The format gate
splits file content on `\n`, so each line kept a trailing `\r` and the gate
failed with "line 2 must be blank" / status-grammar errors for *every* note
the moment it was re-checked-out — the gates passed when first written and
broke on the next `git checkout` (first observed while verifying PR #2,
minutes after adoption). The archived-note header parser and the bilingual
pair-record parser in `scripts/archived-agent-notes.ts` had the same flaw,
and byte-exact sealing hashes (sha256 / git blob) would drift whenever an
EOL rewrite touched a sealed artifact.

## Decision

Line parsing is now CRLF-tolerant at the three places that read note text:
`scripts/verify-agent-note-format.ts` splits on `/\r?\n/`, and
`scripts/archived-agent-notes.ts` does the same in both `pairMeta` and
`validateHeader`. Hash computation stays deliberately byte-exact — tolerance
applies to grammar, never to sealed content identity. A repo-root
`.gitattributes` pins `* text=auto eol=lf` (plus common binary guards), so
checkouts reproduce LF bytes regardless of `core.autocrlf`; the working tree
was renormalized once via `git add --renormalize .` followed by
`git checkout-index -f -a`.

## Alternatives considered

**Require contributors to set `core.autocrlf=false`.** Lost: clone-local
config is not enforceable from the repository, and the gates must hold on
every existing and future clone.

**Trim `\r`/trailing whitespace before comparing instead of strict grammar.**
Lost: it would weaken the documented format contract (blank lines are
meaningful structure); tolerance belongs exactly and only at the EOL
boundary.

**Add `.gitattributes` without touching the gates.** Lost: editors can still
save CRLF into working files at any time; the gates must not depend on
attributes having been applied to the current working tree.

## Consequences

Gained: Windows-first development no longer fights its own tooling — gates
stay green across checkouts, editor saves, and fresh clones, and sealed
archive hashes remain stable because bytes no longer change under EOL
rewrites. Cost: the whole tree is pinned to LF (a one-time renormalization),
and any future binary asset must be registered in `.gitattributes` or git's
text detection may mangle it.
