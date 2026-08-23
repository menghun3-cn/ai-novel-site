# Agent Note: Reader auth surface

Status: implemented

English | [中文](2026-08-24-reader-auth-ui.md)

## Problem

PR31 shipped reader accounts as library functions with no HTTP or UI: the
roadmap's 登录/注册 entries pointed nowhere, and the site header had no way
to reflect who was reading.

## Decision

Four public routes + two pages + one header component:

- **`POST /api/auth/register|login`** — zod-validated, delegate to the core
  service, respond `{user, expiresAt}` and set `reader_session` HttpOnly
  SameSite=Lax cookie (30d). Errors flow through the shared admin
  `handleError` mapping (USERNAME_TAKEN→409, INVALID_CREDENTIALS→401 …).
  **Secure flag is opt-in** via `READER_COOKIE_SECURE=1` — default off so
  plain-HTTP self-hosted deployments don't silently drop the login cookie.
- **`POST /api/auth/logout`** — deletes the server session (idempotent) and
  clears the cookie with Max-Age=0.
- **`GET /api/auth/me`** — always 200; `{user:null}` when anonymous so the
  client probes state without error handling.
- **/login · /register pages** — single-column forms matching the site's
  neutral/sky language: visible labels, password 显示/隐藏 toggle,
  autocomplete hints, disabled-until-valid submit, inline role="alert"
  errors with friendly text (错口令 → 用户名或密码不正确; duplicate →
  用户名已被占用), cross-links between the two pages. Success dispatches a
  `reader:changed` window event then routes (login→/, register→/shelf).
- **ReaderMenu in Header** — client component: anonymous renders 登录/注册;
  logged-in renders 书架 + username(→/me) + 退出. It re-fetches /me on the
  `reader:changed` event because the (site) layout survives client
  navigation and would otherwise keep stale identity after login. A minimal
  /shelf placeholder (login prompt vs "即将上线" note) lands here so the
  post-register redirect has a real destination; PR34 replaces it.

Verification: test:reader-api 17 assertions driving the real handlers with
NextRequest instances (plain Request lacks `.cookies`, which silently made
currentReader null — caught by the me-with-cookie assertion): validation,
duplicate 409s, Set-Cookie shape, email login, wrong password, logout
clearing + old token dead. CDP audit 7/7: page render, anonymous header,
form scope, register→/shelf with header flipping to 书架/用户名/退出,
logout restoring 登录/注册, wrong-password inline alert.

## Alternatives considered

**Server components reading cookies for the menu.** Would avoid the event,
but the header would need router.refresh() everywhere and still flicker;
one tiny client probe per mount is simpler and cached by the browser tab.

**Middleware-based session guard on /shelf.** Premature until shelf exists;
client-side prompt keeps PR32 self-contained.

## Consequences

Gained: complete credential loop end-to-end with zero full reloads; the
identity primitive is now reachable from every page via the header. Costs:
the `reader:changed` event is an implicit contract any future auth-surface
code must remember to dispatch (documented here); cookie defaults to
non-Secure — deployments terminating TLS should set READER_COOKIE_SECURE=1;
/shelf is a placeholder until PR34.
