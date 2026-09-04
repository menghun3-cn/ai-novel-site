# Agent Note: Reader footer shows the app version

Status: implemented

English | [中文](2026-09-04-footer-version.zh.md)

## Problem

The reader-facing footer rendered the copyright line only —
`© <year> 云燕阅读 · AI小说创作平台` — with no version information. Users
could not tell which build they were on when reporting issues, and the admin
shell already displayed `v<package.json version>` (see `AdminShell.tsx`), so
the reader side was inconsistent with it.

## Decision

Append the app version to the reader footer copyright line, sourced from
`web/package.json` exactly like the admin shell does:

```tsx
<span>
  © {new Date().getFullYear()} 云燕阅读 · AI小说创作平台
  <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500" title={`版本 ${appPackage.version}`}>
    v{appPackage.version}
  </span>
</span>
```

- The version is read at build time via `import appPackage from '../package.json'`
  (server component; `resolveJsonModule` already enabled, same pattern as
  `AdminShell.tsx`), so a release bump flows to the footer automatically.
- The version is rendered muted (`text-xs`, lighter color) after the copyright
  text, with a `title` tooltip stating `版本 <version>`, matching the admin
  shell's `vX.Y.Z` format.

## Alternatives considered

**Hard-code the version string in the footer.** Rejected: it would drift from
the actual `package.json` version on every bump; the build-time import keeps a
single source of truth.

**Read from an API or runtime env.** Rejected: unnecessary round-trip for a
static value; the package.json import is already the established pattern in
this repo.

## Consequences

- Readers can now report the exact build (`v8.3.1` at the time of this change)
  from the footer, matching the admin shell's version display.
- The footer stays a server-rendered component; no client-side fetch or state
  was added.
- Next release bumps (e.g. 8.3.1 → 8.3.2) will be reflected automatically
  after a rebuild; the ISR pages' 60s cache window may delay the update on
  already-cached pages.
