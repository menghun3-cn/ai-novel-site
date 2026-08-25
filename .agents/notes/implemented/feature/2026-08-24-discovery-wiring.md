# Agent Note: Discovery wiring and book stats display

Status: implemented

English | [中文](2026-08-24-discovery-wiring.md)

## Problem

PR37 shipped the signal columns and endpoints, but nothing in the UI called
them: chapter pages recorded no views, and readers had no visibility into a
book's heat. The feed existed only as an untested-from-the-browser API.

## Decision

- **ViewTracker** (chapter page, client) — fires `POST …/view` once on
  mount (keepalive), then a passive scroll listener posts `…/finish` exactly
  once when scroll ratio ≥95%, self-removing after. Anonymous-friendly and
  deliberately separate from the login-gated ProgressReporter: heat signals
  must count the majority who never register.
- **BookStatsLine** (detail page, server component) — renders
  `{n} 次阅读 · {n} 人收藏 · 完读率 {p}%` straight from
  `getBookStats(book.id)`; renders nothing until the book has at least one
  view or favorite, so untouched books keep the clean V2 look.
- **verify-discovery-api** — 13 route-handler assertions: 404s for unknown
  book/chapter, PV accumulation (2 views → viewCount 2), finish-rate 0.5
  after 1 finish over 2 views, stats shape, anonymous feed lacking 猜你喜欢,
  logged-in feed including it.

Also fixed a latent build break: discovery.ts initially imported
`./domain.js` / `./db.js` — the web build compiles core sources directly and
this repo's convention is extensionless relative imports; typecheck alone
didn't catch it because tsx resolves both.

## Alternatives considered

**Merge ViewTracker into ProgressReporter.** One component, but couples an
always-on anonymous write to a login-gated one and forces the finish
threshold (95%) to share state with progress throttling; two small
components with single responsibilities won.

**Stats via client fetch.** Detail page is already force-dynamic and
server-rendered; a client round-trip adds flicker for data available at
render. Server component it is.

**Show 完读率 even at 0%.** A 0% badge reads as broken rather than honest
for a book with 1 view; hide the segment until there's signal.

## Consequences

Gained: the signal loop is live end-to-end — reading a chapter now moves
the numbers that PR39's homepage will rank by. Costs: every chapter open
costs one tiny POST (acceptable; keepalive, no await); finish fires at most
once per page-load even across re-scrolls (session-level honesty, not
per-reader uniqueness); the `.js` import incident is a reminder that web
build exercises core sources differently than tsx — build:web belongs in
every PR's gate, not just release.
