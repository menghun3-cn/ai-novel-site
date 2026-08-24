# Agent Note: Scheduler service missing from docker-compose — AI serialization never ran

Status: implemented

English | [中文](2026-08-24-scheduler-missing-docker.zh.md)

## Problem

The AI serialization daily pipeline (V5 `runAiSerializationCycle`) was
configured and enabled in the Web admin for the book "星海余烬" (hour=9,
count=2, autoPublish=true, minChars=500), but **chapters were never
generated**. The `ai_serialization` table contained the correct row with
`last_run_date = NULL`, and `generation_jobs` was empty.

Root cause: `docker-compose.yml` defined only a `web` service (Next.js
`next start`). The scheduler entry point `scripts/publish-scheduler.ts`
(`npm run scheduler`) — the only caller of `runAiSerializationCycle()` — was
not running anywhere in the deployment. No HTTP route triggers the cycle;
it is purely timer-driven.

The V5 tables (`ai_serialization`, `generation_jobs`) existed in the DB at
deploy time because the deployed `core/src/db.ts` was already current; a
local checkout tested against a stale `data/novel.db` that predates V5,
leading to an earlier incorrect hypothesis about missing tables. The
production DB was intact.

## Decision

Add a `scheduler` service to `docker-compose.yml` as a sidecar:

- **Shared volume**: `./data:/app/data` — same SQLite database as `web`, same
  `NOVEL_DATA_DIR=/app/data` for `resolveDataDir()`.
- **Command**: `npx tsx scripts/publish-scheduler.ts` — `tsx` is a devDep in
  the root `package.json` and is installed by the deps stage (non-production
  `npm install` in the Dockerfile).
- **Environment**: `PUBLISH_TICK_SECONDS=60` (default; overridable).
- **No port exposure**: the scheduler talks only to the database; it does not
  serve HTTP.

Dockerfile Stage 3 gains `COPY scripts/publish-scheduler.ts ./scripts/` so
the entry point is present in the scheduler container.

## Consequences

- `docker compose up -d` now starts **two** containers: `novel-web` and
  `novel-scheduler`. Both restart `unless-stopped`.
- Every 60 seconds the scheduler calls `runPublishCycle()` (V3 timed
  chapters) then `runAiSerializationCycle()` (V5 AI serial). Both are
  idempotent via `last_run_date` and `autopilot_last_date` date guards.
- Existing deploys need one `docker compose build scheduler && docker
  compose up -d scheduler` to activate; the web service rebuild is
  unnecessary unless the Dockerfile changed.
- The scheduler uses the same image as web, so a `docker compose build`
  after `Dockerfile` edits builds for both.

## Verification

Deployed to 124.71.38.99 (`/home/app/novel-web-publisher`). After
`docker compose build` and `docker compose up -d`, the scheduler
immediately triggered:

```
novel-scheduler | [scheduler] started, tick=60s
novel-scheduler | [2026-08-24T10:38:24.761Z] ai-serial: triggered=1 enqueued=2 processed=2
```

The two generation jobs failed with `AI_PROVIDER_FAILED: network error:
fetch failed` — the container cannot reach `https://zshy.muhn.edu.cn/dsapi/v1`
(DNS or network policy issue). This is a separate problem; the scheduler
infrastructure itself is working correctly.
