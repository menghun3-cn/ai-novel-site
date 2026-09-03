# Agent Note: Markdown cache key must not depend on node:crypto — client bundling fails

Status: implemented

English | [中文](2026-09-03-markdown-node-crypto-client-bundle.zh.md)

## Problem

`web/lib/markdown.ts` imported `createHash` from `node:crypto` to build the
content-addressed cache key for rendered HTML. The module is used by both
server pages (`(site)/books/[slug]/chapter/[number]`, `(site)/short/[id]`)
and the client component `app/admin/(dash)/works/[id]/page.tsx`, which calls
`mdToHtml()` in the browser for the "渲染预览" (render preview) feature.

During `next build`, webpack pulls `markdown.ts` into the client bundle for
that page and fails with:

```
UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins
```

The `node:` scheme is not resolvable in the browser bundle, so the production
build (and therefore every deploy) failed to compile.

## Decision

Remove the `node:crypto` dependency from `web/lib/markdown.ts` entirely:

- The cache key is now a **deterministic pure-JS hash**: two independent
  32-bit FNV-1a passes (different seeds, `0x811c9dc5` / `0x9e3779b9`)
  combined into one 64-bit hex string.
- The same code runs identically on the server and in the browser, so the
  module can stay shared without environment branches.
- The cache contract is unchanged: same content → same key; edited content →
  new key → cache miss → re-render. Collision probability over ≤1000 LRU
  entries is negligible for a cache key, and the hash is not used for
  security.

The remaining `node:` imports in the codebase (`admin-api.ts`,
`admin-media.ts`, `api/tts/route.ts`) are only reachable from server-only
route handlers, so they do not leak into client bundles and were left as-is.

## Alternatives considered

**Keep `node:crypto` and add a webpack fallback / externals config.**
Rejected: it works around the symptom in one place while leaving the shared
module environment-dependent; any future client-side caller would need the
same escape hatch. Removing the dependency makes the module safe by
construction.

**Duplicate a server-only markdown module and call it via an API route.**
Rejected: the preview feature legitimately renders in the browser, and
splitting the module would add an API round-trip plus two versions of the
same logic to maintain.

**Use `crypto.subtle` (WebCrypto).**
Rejected: `digest()` is async, which would force `cacheKey` and the cache
lookup to become async for no benefit; the key needs no cryptographic
strength, only determinism.

## Consequences

- `next build` compiles again; verified locally with a full production build
  (`npm run build -w web`), exit code 0.
- The admin "渲染预览" still renders markdown entirely client-side as before.
- Cache-key format changed (sha256 hex → FNV-1a 64-bit hex); the in-process
  LRU is keyed by content only, so no persisted data or wire contract is
  affected.
- Behavior is identical on server and client, so no environment-specific
  divergence can reappear for this module.
