# Agent Note: Reader accounts and sessions

Status: implemented

English | [中文](2026-08-24-reader-users.md)

## Problem

The public reading site (V2) was anonymous-only: no accounts, no way to
attach the roadmap's §9 personalization (书架/历史/收藏/订阅) to a person.
Admin auth existed but is a single shared token — wrong shape for public
self-service registration.

## Decision

`core/src/reader.ts`, two tables, zero new dependencies:

- **users** — `username` + `email` both UNIQUE COLLATE NOCASE (one
  case-insensitive namespace each), `password_hash`. Validation: username
  2-24 chars (`[\u4e00-\u9fa5A-Za-z0-9_]`, so Chinese usernames work),
  email regex, password ≥8. Violations raise the new generic
  `INVALID_INPUT` (400); collisions raise `USERNAME_TAKEN` /
  `EMAIL_TAKEN` (409).
- **sessions** — opaque 64-hex token (32 random bytes), 30-day TTL,
  `ON DELETE CASCADE` from users. `getSessionReader(token)` joins and
  lazily sweeps expired rows on any miss. Bad/expired →
  `SESSION_EXPIRED` (401).

Password hashing is node:crypto **scrypt** (N=16384 default, 16-byte salt,
64-byte key) stored as `scrypt:salt:key`; verification uses
`timingSafeEqual`. `loginReader` accepts username *or* email and runs a
dummy scrypt when the account doesn't exist so response timing doesn't
leak account existence. Registration returns a live session (no separate
login step), matching modern signup UX.

Verification: `npm run test:reader` — 15 assertions covering validation
bounds, case-insensitive uniqueness on both fields, login via either
identifier, wrong-password and ghost-account paths, logout invalidation +
idempotency, forged tokens, and lazy expiry sweep.

## Alternatives considered

**bcrypt/argon2 packages.** Rejected for now: native deps complicate the
zero-install story; scrypt is in Node core and is the same family of KDF.
Revisit if we ever need tunable memory hardness beyond defaults.

**JWT instead of server sessions.** Lost instant revocation and the logout
guarantee; sessions are one indexed row lookup and we're already
SQLite-resident.

**OAuth/magic links.** Scope creep for §9; plain credentials satisfy it.
Email verification is a natural follow-up (the schema already has unique
emails to build on).

## Consequences

Gained: a real identity primitive for V6 personalization; admin token
remains untouched as an ops secret, separate from reader identities. Costs:
scrypt is CPU-hungry by design (~50-100ms per hash) — fine at human signup/
login rates, do not call it in loops; session revocation is per-token only
(no "log out everywhere" yet); emails are stored plaintext (needed as a
login identifier; hashing them would break that).
