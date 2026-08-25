# Agent Note: Review console UI

Status: implemented

English | [中文](2026-08-23-review-console-ui.zh.md)

## Problem

V3's review workflow and autopilot had service functions and HTTP APIs
([related](2026-08-23-publish-scheduler-api.md)) but no operator surface:
pending chapters were invisible without curl, approval required hand-built
requests, and autopilot configuration was database-only.

## Decision

A dedicated **审核队列** page at `/admin/review` (new sidebar entry with a
live red count badge driven by `admin:review-changed` window events): FIFO
table of pending chapters with book links, per-row 批准·立即发布 / 定时 /
驳回 actions. 定时 opens a modal with datetime-local input (defaults to the
next full hour); 驳回 opens a modal whose note becomes the chapter's
`review_note`. Success/error feedback uses the shared Notice; every action
re-dispatches the badge event so the sidebar count tracks reality.

Book detail integrates the flow at the source: draft rows gain a 送审 icon
button, rejected chapters render their note inline (`驳回:…` in warning
tone), the edit modal disables its status select while a chapter is
`pending_review` (review actions belong to the queue, not the generic
editor), and a new 每日自动发布 card round-trips `enabled/hour/count` plus a
read-only last-run date (hidden until the scheduler first fires). The
dashboard header now shows a clickable 待审核 stat.

Verification follows the established CDP audit: seeded data through real
APIs, headless Edge asserts 18 structural/interaction checks — including
clicking 批准·立即发布 and observing the row leave, the notice appear, and
the badge decrement; submitting from book detail and watching the badge
increment; 375px drawer/table containment; zero horizontal overflow.
typecheck and production build pass.

## Alternatives considered

**Inline approve/reject inside the books table.** Lost: review is a
cross-book workflow — its home page should list work oldest-first across all
books, which per-book tables cannot express.

**Optimistic UI updates for review actions.** Lost this round: approve
mutates publishing state irreversibly (first-published timestamp); reloading
through the API keeps UI truth equal to server truth at trivial cost.

**Polling the badge count on an interval.** Lost: explicit events after each
action keep the number exact without background chatter; a stale badge only
occurs if another operator acts concurrently, acceptable for a single-operator
console.

**Separate rejection-reason page/history.** Deferred: the note lives on the
chapter and shows inline where the author/producer will act on it; an audit
log matters when multiple reviewers exist (post-V3).

## Consequences

Gained: the complete V3 loop — write → submit → review → schedule/publish →
autopilot config — is operable from the browser, with the sidebar badge as a
persistent work-remaining indicator. Cost: the badge fetches once per
navigation and after in-tab actions, so concurrent-operator changes appear on
next navigation rather than live; the schedule modal trusts client clocks for
its default value (server validates the ISO string either way).
