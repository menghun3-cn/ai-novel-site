# Agent Note: Edge TTS switched to an OpenAI-compatible cloud wrapper

Status: implemented

English | [中文](2026-09-15-edge-tts-openai-compatible-api.zh.md)

## Problem

The listen-back (听书) `edge` engine called Microsoft Bing's speech endpoint
directly over a WebSocket from the server: `web/lib/edge-tts.ts` minted
Sec-MS-GEC tokens and `web/app/api/tts/route.ts` streamed base64 audio chunks
from `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`.
That path is brittle: the token algorithm and endpoint keep drifting,
outbound access to Microsoft's endpoints is often firewalled (the production
host could never connect), and there is no controlled contract to pin down.
The upstream ai-edge-tts2api project now exposes a maintained
OpenAI-compatible HTTP wrapper (`POST /v1/audio/speech`, Bearer auth, raw
`audio/mpeg` response) that handles voices, chunking, concurrency, and the
token dance server-side, and the user asked to switch this repo's edge engine
to it.

## Decision

Replace the bing WebSocket client with a single HTTP POST to the
ai-edge-tts2api OpenAI-compatible endpoint:

- `web/app/api/tts/route.ts` `synthesizeEdge(text, voice, speed)` now does one
  `fetch(EDGE_TTS_API_URL)` with `Authorization: Bearer ${EDGE_TTS_API_KEY}`
  and body `{ model: 'tts-1', input, voice, speed, response_format: 'mp3' }`
  under a 30 s `AbortController` timeout, proxying the raw `audio/mpeg`
  response to the browser.
- `EDGE_TTS_API_URL` / `EDGE_TTS_API_KEY` come from env; the fallbacks are
  `https://edgetts2api.menghun3.cc/v1/audio/speech` (custom domain, the default
  since V10.8 — the ai-edge-tts2api README's `*.workers.dev` endpoint is
  DNS-poisoned on mainland networks) and the shared deployment key; the key is
  read only in the server route, never in shared client code.
- Everything bing-specific is deleted: Sec-MS-GEC minting, the WSS URL, the
  user agent, `parseAudioChunk`, `buildEdgeSSML`, and the `EDGE_TTS_PROXY` env
  var (replaced by `EDGE_TTS_API_URL` in `docker-compose.yml` and README).
- Error mapping for the browser: 401 → auth-failure hint, `AbortError` →
  timeout, `TypeError` → network/firewall restriction (the frontend appends
  the 可改用 Kokoro 本地语音 hint), non-2xx → upstream `error.message`
  passthrough.
- The `GET /api/tts` availability probe now reports exactly
  `{"engines":["edge","native"]}`; the `kokoro` engine was removed in V10.8
  (see
  [edge-tts-custom-domain-kokoro-removal](../../implemented/simplification/2026-09-15-edge-tts-custom-domain-kokoro-removal.md)).

## Alternatives considered

- **Keep the bing WebSocket client and patch it.** Rejected: it was already
  the fragile part (token-algorithm drift, endpoint/firewall flakiness); the
  wrapper moves exactly that maintenance off this repo.
- **Proxy through self-hosted edge-tts npm packages.** Rejected: same
  token/WS surface, just relocated; the user explicitly asked for the
  ai-edge-tts2api HTTP contract.
- **Two-phase transport (try WS, fall back to HTTP).** Rejected: doubles the
  surface for a transitional state; the engine-level fallback matrix
  (edge → kokoro) already covers unavailability.

## Consequences

- The edge engine needs outbound HTTPS to the endpoint; since V10.8 the
  default is the custom domain `https://edgetts2api.menghun3.cc`, which is
  reachable from both this workspace and the production host (mainland China):
  `GET /v1/models` 200 and `POST /v1/audio/speech` 200 → ~20.7 KB `audio/mpeg`
  were verified live from the production host. The README's `*.workers.dev`
  host remains unreachable there (DNS hijack + SERVFAIL; TCP 443 fails).
- The shared API key is a live credential documented in the ai-edge-tts2api
  README; deployments can override it with `EDGE_TTS_API_KEY`. Server env does
  not need to change for the switch to take effect.
- Version bumped 8.3.8 → 8.3.9 (V10.7.7); CHANGELOG [Unreleased] documents the
  engine switch and its verification (typecheck, next build,
  `test:tts-reader` 13/13, mock-upstream e2e).
- Cross-links: the transport description in
  [user-categories-and-list-performance](../../implemented/feature/2026-09-04-user-categories-and-list-performance.md)
  was updated in place (edge is now an HTTP POST to the wrapper, not a bing
  WebSocket); the
  [local-kokoro-tts](../../archived/feature/2026-09-03-local-kokoro-tts.md)
  note (carrying the same transport update) was archived together with the
  V10.8 kokoro removal.
