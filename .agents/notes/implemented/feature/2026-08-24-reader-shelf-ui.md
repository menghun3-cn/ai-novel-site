# Agent Note: Shelf UI and reading progress reporting

Status: implemented

English | [中文](2026-08-24-reader-shelf-ui.md)

## Problem

PR33's personalization endpoints had no face: the roadmap §9 surfaces —
我的书架 with 阅读至第N章·进度%·有更新, detail-page 收藏/订阅 buttons,
chapter-level progress sync, 阅读历史 — were all missing. The /shelf route
was still PR32's placeholder.

## Decision

Three client components + one page rewrite + one new page:

- **BookActions** (detail page) — ♡收藏 / +订阅 pill pair. On mount probes
  `/api/auth/me` then both state endpoints; click toggles via POST and
  reflects the returned boolean. Anonymous clicks redirect to /login.
- **ProgressReporter** (chapter page) — passive scroll listener computing
  `scrollY / (scrollHeight - innerHeight)`, monotonic (never regresses
  within a chapter). Sends on first meaningful movement, then throttled:
  ≥5% delta after 1.5s, or 8s heartbeat; `pagehide`/`visibilitychange`
  fire a keepalive final write. Gated on login (one /me probe). Renders
  null — pure side-effect component.
- **/shelf** — fetches /api/me/shelf; 全部/收藏/订阅 tabs; each row shows
  title, 有更新·最新第N章 emerald badge when `hasUpdate`, author +
  阅读至第N章·进度P% line, and a 继续阅读 button targeting
  `min(progressChapter + (percent≥95 ? 1 : 0), latest)` — finished chapters
  advance, in-progress ones resume. Empty/authenticated/anonymous states
  all designed.
- **/me** — account card (avatar initial, username, email, 退出登录) plus
  最近阅读 list from /api/me/history linking straight to the chapter.

Verification: clean-room CDP audit (fresh DB → seed book+2 published
chapters → headless Edge) 12/12: register-in-page, button flip to
已收藏/已订阅, shelf entry with 第1章 100%, badge rendered, 继续阅读 →
chapter/2, badge disappears after catching up, history shows 第2章 · 100%,
logout restores anonymous header. typecheck + full build green.

## Alternatives considered

**Server-rendered shelf from cookies.** Faster first paint but loses the
tab filter without client JS anyway; kept one fetch shape consistent with
the rest of the reader surface.

**IntersectionObserver per paragraph for progress.** Precision we don't
need; scroll-ratio matches what the progress bar already shows users.

**Separate history table.** reading_progress already *is* history (one row
per book = current position); a log would double storage for no §9 need.

## Consequences

Gained: the complete §9 loop is user-visible end-to-end; progress now
follows accounts across devices. Costs: ProgressReporter writes at most
~1 req/8s per active reader (keepalive writes are tiny); shelf ordering
relies on progress updated_at only (favorites without progress sort by
favorited time via COALESCE); /me history caps at 20 rows client-requested.
