# Agent Note: Admin API route handlers with token auth

Status: implemented

English | [中文](2026-08-23-admin-api-token-auth.md)

## Problem

The core admin services ([book/chapter](../feature/2026-08-23-admin-book-chapter-management.md),
[author/category/tag](../feature/2026-08-23-admin-author-category-tag-management.md))
had no HTTP surface. The upcoming admin UI needs to call them from the
browser, and the roadmap's later stages (V4 AI Engine, V5 auto-serialization,
Hermes integration) need a stable way to push content from outside the
Next.js process. Without an explicit API contract, every future consumer
would be tempted to reach into the database directly.

## Decision

`web/app/api/admin/**` exposes the management surface as Next.js 15 Route
Handlers (plain `Response`, `dynamic = 'force-dynamic'`):

- `GET|POST /api/admin/books`, `GET|PATCH|DELETE /api/admin/books/[id]`
- `GET|POST /api/admin/books/[id]/chapters`,
  `GET|PATCH|DELETE /api/admin/books/[id]/chapters/[number]`,
  `PUT /api/admin/books/[id]/chapters/order`
- `GET|POST /api/admin/authors`, `GET|PATCH|DELETE /api/admin/authors/[id]`
- `GET|POST /api/admin/categories`, `GET|PATCH|DELETE /api/admin/categories/[id]`
- `GET|POST /api/admin/tags`, `GET|PATCH|DELETE /api/admin/tags/[id]`

Shared behavior lives in `web/lib/admin-api.ts`: `withAdmin()` wraps every
handler (auth → handler → error mapping), request bodies are validated with
zod (`VALIDATION_FAILED`/`INVALID_JSON` → 400, slug pattern enforced at the
edge), and every `CoreError` code maps mechanically to HTTP — `*_NOT_FOUND`
→ 404, `*_TAKEN`/`*_IN_USE`/`CHAPTER_NUMBER_CONFLICT` → 409,
`INVALID_*` → 400; unknown errors log and return a bare 500.

Auth (V2 scope): the `ADMIN_TOKEN` environment variable is compared against
the `Authorization: Bearer` header or `x-admin-token` header using
length-hiding, timing-safe SHA-256 digest comparison. With `ADMIN_TOKEN`
unset the whole admin API answers `503 ADMIN_API_DISABLED` instead of being
open by accident. The reader-facing user system remains V6 scope.

Verification: `npm run test:api` (`scripts/verify-admin-api.ts`) calls the
route handlers as functions against a temp-dir database — auth (401/503),
CRUD happy paths, and every error-mapping class (400/404/409) — 20 checks.

## Alternatives considered

**Standalone Fastify service next to Next.js.** Lost: two deployables, two
auth stories, duplicated CORS/session plumbing for an admin that ships in
the same UI as the site; route handlers keep one process and one deploy.

**Next.js middleware for auth.** Deferred: per-handler wrapping via
`withAdmin()` is explicit and unit-testable without a server; middleware can
still be layered on when the admin UI lands.

**Server actions only (no REST).** Lost: it would bind the capability to the
React client forever; Hermes/AI-engine integration in V4/V5 explicitly needs
a plain HTTP contract.

**Cookie-session auth now.** Deferred: there are no users yet (V6); a shared
operator token is the smallest honest mechanism until then.

## Consequences

Gained: every management capability is reachable over HTTP with mechanical
error semantics, testable in-process; the admin UI becomes a thin client.
Cost: the API is only as protected as `ADMIN_TOKEN` secrecy — operators must
set a strong value in production or leave the API disabled; zod schemas
duplicate field constraints that core also enforces, so the two layers must
evolve together.
