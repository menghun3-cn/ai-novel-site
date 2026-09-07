# Agent Note: README screenshots section and screenshot.md index

Status: implemented

English | [中文](2026-09-07-readme-screenshots.zh.md)

## Problem

The repository README documented architecture, the feature matrix, deployment,
and commands, but had **no visual presentation**: nothing showed what the
reader site or the admin console actually look like. Meanwhile the
`screenshot/` directory had accumulated 12 PNG captures with no index and no
entry point from the README, so a visitor could not see the product without
cloning and running it.

## Decision

Add a `## 截图` (Screenshots) section near the top of `README.md` (right after
the intro table) that embeds only `screenshot/1.png` and `screenshot/5.png`
side by side (`width="49%"`, centered) — a curated pair that keeps the README
light. Directly below the images, one line links to the new `screenshot.md`,
which is the canonical index listing **all** screenshots:
`screenshot/1.png` … `screenshot/12.png`, in a two-column table
(`序号 | 截图`). All assets stay in the repo-root `screenshot/` directory and
both files reference them with the relative path `screenshot/<n>.png`.

The rule going forward: the README section shows only the curated pair; every
new capture is added to `screenshot/` and listed in `screenshot.md`, and is
promoted into the README section only when deliberately chosen.

## Alternatives considered

**Embed all 12 screenshots directly in README.md.** Rejected: the README is
already long (architecture diagram, feature matrix, deployment, env vars); a
wall of 12 full-width images would dominate it and slow GitHub rendering.

**Host screenshots externally (e.g. imgur) and link out.** Rejected: external
hosting can rot and breaks offline/self-hosted reading; keeping assets in-repo
matches the repository's self-contained documentation style.

**Single clickable thumbnail strip in the README linking to each image.**
Rejected: more markup complexity for marginal gain; the two-image embed plus
one index file is simpler to maintain.

## Consequences

- The README now gives a visual first impression (1.png, 5.png) and one obvious
  "more screenshots" hop to `screenshot.md`.
- `screenshot.md` is the single inventory of all screenshots; adding a capture
  is a one-line table addition.
- The 12 PNG assets (~1.9 MB total) are committed to the repository: they grow
  clone size slightly but keep the docs self-contained and versioned alongside
  the UI they show.
- The screenshots are static snapshots: they can drift from the current UI
  until someone re-captures and updates the files.
