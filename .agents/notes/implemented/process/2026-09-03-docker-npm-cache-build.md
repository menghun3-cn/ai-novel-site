# Agent Note: Docker builds reuse npm downloads via BuildKit cache mounts

Status: implemented

English | [中文](2026-09-03-docker-npm-cache-build.zh.md)

## Problem

On the deploy server, every `docker compose build` re-downloaded the full
npm dependency tree. The `deps` stage copied only the manifest files before
`npm install`, so the layer cache *should* have been hit when the manifests
were unchanged — but whenever the stage re-ran for any reason (manifest
change, `rebuild.sh --clean`, `docker builder prune`, or a fresh `--pull` of
the base image), npm fetched every tarball over the network again. The npm
package cache (`~/.npm`) lived inside the container layer and died with it.
The same applied to the Next.js compile cache: a re-run of the `build` stage
recompiled everything from scratch.

## Decision

Keep the manifest-first layer structure, and add three cache mechanisms to
the `Dockerfile`:

1. **npm download cache via BuildKit cache mount.** The `deps` stage installs
   with `RUN --mount=type=cache,target=/root/.npm npm install
   --prefer-offline`. The npm cache now persists across builds on the host,
   so even when the install layer re-runs, packages are resolved from the
   local cache instead of re-downloading. `--prefer-offline` avoids redundant
   registry metadata round-trips when the cache is warm.
2. **Next.js compile cache via cache mount.** The `build` stage runs
   `RUN --mount=type=cache,target=/app/web/.next/cache npm run build -w web`,
   so a rebuild after dependency changes does not recompile the whole app.
3. **`# syntax=docker/dockerfile:1` header.** Required for cache-mount
   support in the BuildKit frontend.
4. **Smaller build context.** `.dockerignore` now also excludes `data`,
   `web/public/covers`, `web/.next`, and `.dsh-tmp` — these are volume mounts
   or local artifacts that never belong in the image context.

`npm install` stays (not `npm ci`): the repo bumps workspace versions without
always syncing `package-lock.json`, and `npm ci` would fail on any such drift.
The cache mount solves the download problem regardless of that.

## Alternatives considered

**Switch `npm install` → `npm ci`.** `npm ci` is deterministic and faster,
but it hard-fails when `package.json` and `package-lock.json` drift (which
this repo's release bumps sometimes allow). Making CI green would require
locking the release flow to always regenerate the lockfile; deferred.

**Persist `node_modules` itself across builds (volume or cache mount).** A
`node_modules` cache mount risks stale native binaries (`better-sqlite3`) and
platform-specific state leaking between images; the npm tarball cache is the
safe, content-addressed layer to share.

**Rely on the layer cache alone.** Already present and still useful (manifest
unchanged → install layer skipped entirely), but it provides zero benefit on
`--no-cache` or pruned builds; the cache mounts cover exactly those cases.

## Consequences

- Deploy-server rebuilds no longer re-download dependencies or recompile the
  app when caches are warm: repeated `./rebuild.sh` is fast, and even
  `--clean` builds reuse the host-side npm tarball cache.
- Requires BuildKit (`docker buildx` / Docker ≥ 23 with BuildKit default);
  the `# syntax` header makes older BuildKit fail loudly instead of silently
  ignoring the mounts.
- `npm install --prefer-offline` keeps first-time installs correct (cache is
  empty then) while warm-cache installs skip redundant metadata requests.
- Build context is smaller on the wire for remote builders (`data`,
  `web/public/covers` are runtime volume mounts, `web/.next` is a local
  artifact).
