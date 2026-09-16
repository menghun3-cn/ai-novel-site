# Agent Note: web and scheduler share one Docker image via an explicit Compose tag

Status: implemented

English | [中文](2026-09-16-compose-shared-docker-image.zh.md)

## Problem

The repo builds one runtime payload from a single `Dockerfile` — base image,
`node_modules`, `core/`, `importer/`, the Next.js production build, and the
two entry scripts — yet `docker-compose.yml` gave both `web` and `scheduler`
a `build:` with no `image:` field. Compose auto-names every built image
`<project>-<service>`, so each build produced two tags,
`novel-web-publisher-web` and `novel-web-publisher-scheduler`, for
byte-identical content. The only real difference between the services is the
entry command, and that lives in `command:` / `CMD` metadata applied at
`docker compose up` time — never inside the image.

Storing the same payload twice is wasteful and fragile. `docker image ls`
reports ~875 MB per tag, and while identical builds do share layers on disk,
that sharing is incidental: the floating base tag `node:22-slim`, a
`--no-cache` rebuild, or a pruned builder cache silently breaks it, and the
real cost doubles to ~1.75 GB with two names to push, pull, upgrade, and
audit.

## Decision

Declare one explicit image name on both services in `docker-compose.yml`:

```yaml
web:
  image: novel-web-publisher:latest
  build:
    context: .

scheduler:
  image: novel-web-publisher:latest
  build: .
```

Compose builds the shared payload once (the second service's build is a full
cache hit and re-tags the same content), and both containers run from the
single `novel-web-publisher:latest` tag. Runtime roles are untouched: `web`
keeps the Dockerfile default `npm run start -w web`, `scheduler` keeps its
`command: ["npx", "tsx", "scripts/publish-scheduler.ts"]` override, and no
service's ports, volumes, `mem_limit`, restart policy, or `stop_grace_period`
changes. Merging images is not merging containers — the two remain
independent processes with their own limits and lifecycles.

Existing deploys must remove the two legacy auto-named tags once after the
first rebuild:

```sh
docker image rm novel-web-publisher-web novel-web-publisher-scheduler
```

## Alternatives considered

**A slim scheduler-only image (dedicated final stage without the Next.js
build).** The scheduler's runtime needs are a strict subset of the web
payload — the heavy parts (base image, shared dependency tree) would be
stored in both images, so total disk usage would be *larger* than one shared
image while the `Dockerfile` gains a second surface to maintain. Rejected.

**Running web and scheduler in a single container.** Couples two unrelated
lifecycles: the scheduler is a 24/7 tick loop whose graceful stop needs 90 s
to release its lock, and a web crash or redeploy would silently stop
serialization. The separate `mem_limit`s (1500 m vs 256 m) and restart
policies would be lost. The image change deliberately keeps the
two-container topology. Rejected.

**Rely on OverlayFS layer sharing and keep two tags.** Layer dedup only
holds while both builds produce identical digests; a floating base tag or
`--no-cache` rebuild breaks it silently, and two names remain to manage. The
explicit shared tag makes single-copy storage permanent and the topology
self-documenting. Rejected.

## Consequences

- One image tag to build, push, pull, upgrade, and audit; disk usage is
  guaranteed single-copy regardless of base-image drift or no-cache rebuilds.
- Runtime topology, limits, volumes, and deploy flow (`./rebuild.sh`,
  `docker compose up -d`) are unchanged; the existing `npm run pack:deploy`
  zip already ships the compose file, so no packing changes are needed.
- The first deploy after this change needs a one-time cleanup of the two
  legacy auto-named tags following container recreation.

## Related

The
[scheduler sidecar decision](../../bug-fix/2026-08-24-scheduler-missing-docker.md)
introduced the second service and already relied on it sharing the web
image; this note makes that sharing explicit in Compose instead of
incidental.
