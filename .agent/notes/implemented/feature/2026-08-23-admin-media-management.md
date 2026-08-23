# Agent Note: Media management with sandboxed public serving

Status: implemented

English | [中文](2026-08-23-admin-media-management.zh.md)

## Problem

The roadmap's 媒体管理 module (covers, author avatars, illustrations, site
assets) had no storage or upload path: `cover_path`/`avatar_path` columns
could only hold strings someone pasted by hand, and no URL served binary
assets. The admin API ([related](../feature/2026-08-23-admin-api-token-auth.md))
needed an upload endpoint so covers and avatars become real files reachable
from the browser.

## Decision

Media lives as flat files in `data/media/`, located via
`path.dirname(getDbPath())` — one source of truth for the data directory
(`NOVEL_DATA_DIR`-portable, already gitignored through `data/*`).

`web/lib/admin-media.ts` is the gatekeeper: filenames must fully match
`[A-Za-z0-9._-]{1,120}` plus a whitelisted extension (png/jpg/jpeg/webp/
gif/svg); names containing path separators or `..` are **rejected
explicitly**, never silently rewritten; empty files and anything above 5 MiB
are refused (`EMPTY_MEDIA` / `MEDIA_TOO_LARGE` → 400 / 413); duplicates are
`MEDIA_NAME_TAKEN` → 409 so a name always maps to immutable content.
`web/app/api/admin/media/route.ts` lists (`GET`) and uploads (`POST`,
multipart `file` field with optional `name` override);
`.../[name]/route.ts` deletes; failures flow through `withAdmin`'s error
mapping, which now also recognizes `MediaError`.

Public serving is `web/app/media/[...path]/route.ts`: single-segment names
only, content type from the extension map, `Cache-Control: public,
max-age=31536000, immutable` (names are unique), and a
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
sandbox` header on every response — uploaded SVG cannot execute scripts on
the site's origin.

Verification: `npm run test:media` exercises upload happy path, extension
whitelist, traversal rejection, duplicate 409, size cap 413, missing field
400, listing, byte-exact public serving with headers, 404s, and deletion —
14 checks against a temp directory.

## Alternatives considered

**Database BLOBs for media.** Lost: bloats SQLite backups for rarely-read
binaries, complicates streaming/cache headers; files under the existing data
directory keep backup semantics unchanged.

**Silently flattening hostile names to their basename.** Lost while fixing
this feature's tests: `../../evil.png` becoming `evil.png` is safe but
surprising; explicit rejection keeps operator intent visible.

**S3/OSS object storage now.** Deferred: local disk matches the current
single-node Docker deployment; the `/media/*` URL contract survives a later
move to object storage.

**Serving SVG without CSP.** Lost: same-origin SVG executes scripts and would
turn any uploader into an XSS; the sandbox policy keeps SVG usable as images
only.

## Consequences

Gained: covers/avatars have an end-to-end path (upload → URL → column) with
traversal-safe serving; media is portable with the database directory. Cost:
the flat namespace means no per-book organization yet, and deleting a media
file does not clear references that point at it — the admin UI must treat
`cover_path` values as soft references until a cleanup pass exists.
