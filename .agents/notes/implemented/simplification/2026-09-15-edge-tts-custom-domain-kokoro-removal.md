# Agent Note: Edge endpoint default switched to a custom domain; local Kokoro engine removed

Status: implemented

English | [中文](2026-09-15-edge-tts-custom-domain-kokoro-removal.zh.md)

## Problem

Two follow-up problems after the V10.7.7 switch of the `edge` engine to the
ai-edge-tts2api OpenAI-compatible wrapper (see
[edge-tts-openai-compatible-api](../../implemented/feature/2026-09-15-edge-tts-openai-compatible-api.md)):

1. **The wrapper's default endpoint was unreachable from production.** The
   ai-edge-tts2api README endpoint is a `*.workers.dev` host; on the
   production host (mainland China, hcss-ecs-8245) `edgetts2api.edgetts.workers.dev`
   is DNS-poisoned: it resolves to a hijacked `31.13.96.192`, queries return
   SERVFAIL, and TCP 443 fails — upstream documents this as a network property
   ("not a service fault"), but it means the documented default cannot serve
   this deployment. The custom domain `https://edgetts2api.menghun3.cc` is
   directly reachable from both this workspace and the production host with
   the same shared key, so it is a working out-of-the-box default.
2. **The local Kokoro engine was overbuilt for this host.** Added in V10.7 as
   the offline engine and default listen-back engine (see the archived
   [local-kokoro-tts](../../archived/feature/2026-09-03-local-kokoro-tts.md)
   note), it needed ~80 MB q8 model weights plus onnxruntime memory and
   synthesized slowly under memory pressure on the 2-core / 1.8-GiB host
   (20 chars ≈7 s; 100 chars 176–338 s while swapping). Keeping it usable
   pulled a whole chain into the fleet: conditional Dockerfile build args,
   a compose model volume, webpack-`createRequire` workarounds, a serialized
   synthesis queue, and in-container TTS self-tests. The user asked to point
   edge at the custom domain **and** remove the kokoro engine entirely.

## Decision

- **Edge default endpoint = custom domain.** `EDGE_TTS_API_URL` falls back to
  `https://edgetts2api.menghun3.cc/v1/audio/speech` (env override unchanged);
  the shared `EDGE_TTS_API_KEY` default is unchanged. Verified live from the
  production host with the shared key: `GET /v1/models` → 200;
  `POST /v1/audio/speech` → 200, 20,736-byte `audio/mpeg` (MPEG ADTS L3,
  48 kbps, 24 kHz mono). `*.workers.dev` remains a documented mainland-network
  caveat (DNS poisoning), not a code path.
- **Kokoro engine removed everywhere:**
  - `web/app/api/tts/route.ts`: engines are exactly `edge` | `native`;
    `GET /api/tts` returns `{"engines":["edge","native"]}` — no kokoro probe,
    no `503` branch.
  - `web/components/TtsPlayer.tsx`: the kokoro engine option, voice list,
    availability probe and saved-engine fallback are removed; a stale client
    with `KEY_ENGINE='kokoro'` silently falls back to the default `edge`.
    Engine dropdown: 「✨ AI 情感听书」(edge) + 「系统语音」(native).
  - Deleted files: `web/lib/kokoro.ts`, `web/lib/kokoro-server.ts`,
    `scripts/fetch-kokoro-voices.mjs`, `scripts/verify-tts-local.ts`.
  - `Dockerfile`: the `ENABLE_LOCAL_TTS` / `KOKORO_HF_ENDPOINT` args, the
    conditional `kokoro-js-zh` + `onnxruntime-node` install and the voice
    pre-download step are gone; the deps stage is plain
    `npm install --prefer-offline` again.
  - `docker-compose.yml`: the `./models/kokoro` volume, `KOKORO_MODEL_DIR` env
    and the build-arg comments are removed; `next.config.ts`
    `serverExternalPackages` is back to `['better-sqlite3']`.
  - `./rebuild.sh`: only `--clean` remains (`--tts` / `--model` / `--no-tts` /
    `--no-model` and the model-download step removed); no in-container
    `test:tts-local` anymore.
  - `test:*` scripts 44 → 43; all four `package.json` bumped 8.3.9 → **8.4.0**
    (V10.8.0 — feature removal is a minor bump).
- **V10.7 statement revoked.** The claim "kokoro remains the default
  listen-back engine" (V10.7.7 note and i18n) is corrected: the default
  engine is `edge`; engines are `edge` + `native`. The mobile-502 rationale
  that motivated kokoro (carrier / CF middle-layers timing out long edge POSTs,
  see
  [user-categories-and-list-performance](../../implemented/feature/2026-09-04-user-categories-and-list-performance.md))
  stays recorded there as history; the custom domain restores server-side
  reachability and the frontend keeps chunked requests.

## Alternatives considered

**Keep kokoro but demote it to opt-in (edge default).** Rejected: the user
explicitly asked for removal; the onnxruntime chain (conditional deps, build
args, model volume, serialization queue, webpack workaround) would keep paying
maintenance and memory footprint for an engine that is unusably slow on this
host. The custom-domain switch already addresses the server-side reachability
failure that made kokoro attractive in the first place.

**Keep the `*.workers.dev` default and rely on `EDGE_TTS_API_URL` overrides at
deploy time.** Rejected: a documented-but-unreachable default is a trap — the
production host cannot reach it at all, so every deployment would silently
depend on an override. On this repo's release pipeline the default must work
out of the box in mainland China.

**Keep kokoro until an offline replacement exists.** Rejected: no offline
requirement remains for the current deployment (device-side `native` Web
Speech covers the offline case); the precise reintroduction condition plus the
full V10.7 mechanism stays recoverable from the archived notes.

## Consequences

- Listen-back engines are exactly `edge` (default) + `native`; no kokoro
  probe, no `503` path, no 「本地语音」 option in the UI.
- Images no longer install or download the ~80 MB model weights / onnxruntime:
  smaller images and shorter builds. On the host, `./models/kokoro/` is
  orphaned (no longer mounted; removable by hand).
- Edge synthesis now depends on outbound HTTPS to
  `https://edgetts2api.menghun3.cc` from the runtime host; verified from the
  production host (200s above). The 30 s route timeout and the shared-key
  default are unchanged.
- Notes: the
  [local-kokoro-tts](../../archived/feature/2026-09-03-local-kokoro-tts.md)
  feature note and three kokoro bug-fix notes (build-arg fix, synthesis
  serialization, webpack createRequire stub) are archived (frozen);
  [lowmem-kokoro-tuning](../../implemented/bug-fix/2026-09-04-lowmem-kokoro-tuning.md)
  stays active with facts updated in place (its `NODE_OPTIONS` / `mem_limit`
  remain current compose config as general host safeguards);
  [edge-tts-openai-compatible-api](../../implemented/feature/2026-09-15-edge-tts-openai-compatible-api.md)
  and
  [user-categories-and-list-performance](../../implemented/feature/2026-09-04-user-categories-and-list-performance.md)
  were updated in place (endpoint default, engine list).
- Verified: `npm run typecheck`, `build:web`, `test:tts-reader` green; the
  custom-domain endpoint live-tested from the production host; the route
  exercised end-to-end in-sandbox against the real endpoint.
