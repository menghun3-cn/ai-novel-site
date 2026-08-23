# Agent Note: Admin console UI with route-group shell split

Status: implemented

English | [中文](2026-08-23-admin-console-ui.zh.md)

## Problem

V2's six management modules had complete service layers and REST APIs
([related](2026-08-23-admin-book-chapter-management.md),
[related](2026-08-23-admin-media-management.md)) but no operator-facing
interface: covers, chapters, and tags could only be managed by calling HTTP
endpoints by hand. The root layout also hard-wired the reader Header/Footer
around every route, so a `/admin` page would inherit the public-site chrome.

## Decision

Split the app with a Next.js route group: all public pages moved under
`app/(site)/`, which owns Header/Footer in `(site)/layout.tsx`; the root
layout keeps only `html`/`body`. URLs are unchanged and `next build` output
is byte-identical for public routes.

The console lives at `app/admin/` in two shells. `/admin/login` is a
standalone centered card (400px) that collects the `ADMIN_TOKEN`, verifies
it against a real endpoint, and stores it in localStorage.
`app/admin/(dash)/` wraps every other page in `AdminShell` — the LSG
enterprise spec applied literally: 200px/64px collapsible sidebar with
active indicator bar, 56px deep-blue gradient topbar, `#eef4fb` canvas,
40px menu items, 16px content padding. `AdminShell` guards auth on mount
(no token or 401 → redirect to login) and persists collapse state.

Shared primitives live in `components/admin/ui.tsx` (buttons with
primary/secondary/ghost/danger variants and full hover/focus/disabled
states, form fields with visible labels and inline errors, status badges,
modal + 420px confirm dialog with ESC/mask-close, empty states, notices)
and `lib/admin-client.ts` (token storage, fetch wrapper that attaches
`x-admin-token`, normalizes errors, and self-clears on 401). Pages are
client components: dashboard with gradient KPI cards, books table with
search/filter/hide/delete and a create modal, book detail with metadata
form plus chapter table (create/edit modal carrying the
draft/scheduled/published semantics, up/down reorder via `PUT order`,
guarded delete), authors, categories, tags, and a media grid with upload,
copy-URL, and delete.

Verification is a CDP-driven browser audit (`.verify-admin-ui-data/`
tooling, not committed): seed data through the real API, then drive
headless Edge to assert 32 structural/style/responsive checks — shell
dimensions and gradient pixels, badge rendering, filter interaction,
375px drawer + in-table scroll, media loading through `/media`, and
zero horizontal overflow at 1440/375. `next build`, `typecheck`, and the
three API test suites all pass; the public site returns 200 on six
smoke-tested routes after the route-group move.

## Alternatives considered

**Middleware-based auth redirect for `/admin`.** Lost: the token lives only
in localStorage, which server middleware cannot read; the client-side guard
in `AdminShell` keeps the secret browser-side and the API stays the real
enforcement point.

**Reusing the reader Header/Footer inside admin.** Lost: mixes consumer
chrome with an operator console and breaks the fixed-shell scroll model
(body no longer scrolls; each region scrolls independently).

**A component library (shadcn/antd).** Deferred: the console needs ~10
primitives with exact LSG-specified values; hand-rolled Tailwind keeps the
dependency tree flat and the spec literal. A library can replace the
primitives later without touching pages.

**Screenshot-only visual acceptance.** Lost this round: the vision service
was unavailable (403), so acceptance is a DOM/style audit plus pixel-color
sampling of the topbar gradient — deterministic and re-runnable, though it
cannot judge aesthetics.

## Consequences

Gained: operators can run the full V2 surface (books, chapters, authors,
categories, tags, media) from the browser with one token; public pages are
isolated from console chrome. Cost: the token in localStorage is readable
to XSS on the site origin — acceptable while the console is same-origin and
operator-only, but a HttpOnly cookie session is the upgrade path if scopes
grow. Chapter modal interactions were not driven end-to-end in the browser;
their logic is covered by the API test suites.
