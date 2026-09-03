# Agent Note: Local Kokoro Chinese TTS as a listen-back engine alongside Edge

Status: implemented

English | [中文](2026-09-03-local-kokoro-tts.zh.md)

## Problem

The listen-back (听书) feature had two engines: `native` (Web Speech API) and
`edge` (online Edge TTS synthesis proxied through `/api/tts`). Edge requires
outbound connectivity to Microsoft and cannot run offline. The original
`kokoro-js` npm package — the natural local candidate — ships **English-only**
voices (28 `af_*`/`am_*`/`bf_*`/`bm_*` entries hard-coded in the package), so it
cannot produce Chinese speech, and its Chinese phonemization path is unusable.
The deployment requirement was a fully offline Chinese voice engine that falls
back to Edge when unavailable.

## Decision

Add a third engine `kokoro` (本地语音) built on **`kokoro-js-zh` 2.1.7** — a
Chinese fork of kokoro-js whose `VOICES` include eight Chinese voices
(`zf_xiaobei`/`zf_xiaoni`/`zf_xiaoxiao`/`zf_xiaoyi` female, `zm_yunjian`/
`zm_yunxi`/`zm_yunxia`/`zm_yunyang` male) and whose phonemizer uses espeak-ng's
`zh-CN`. The model is `onnx-community/Kokoro-82M-v1.0-ONNX` (q8 quantization,
~80 MB) — its `voices/` directory holds the matching `.bin` embeddings.

Key mechanisms:

- **Conditional build.** `Dockerfile` gains `ARG ENABLE_LOCAL_TTS=0`; when set
  to `1`, the deps stage additionally installs `kokoro-js-zh` +
  `onnxruntime-node` (via `--no-save`, so `package.json`/lock are untouched and
  `=0` images keep their exact size) and runs
  `scripts/fetch-kokoro-voices.mjs`, which copies `espeak-ng.wasm` from the
  `espeak-ng` dependency into `kokoro-js-zh/dist/` (the package ships without
  it, which aborts Chinese G2P) and pre-downloads the eight voice `.bin` files
  (Node builds offline; runtime re-fetches if skipped). The asset logic lives
  in a standalone script rather than an inline `node -e` block: Dockerfile
  line-continuation (`\`) cannot carry a multi-line single-quoted script, which
  fails at parse time with "unknown instruction: const".
- **Runtime detection with Edge fallback.** `web/lib/kokoro-server.ts`
  (`kokoroAvailable()`) reports the engine only when the dependency is
  installed **and** either `KOKORO_MODEL_DIR` (docker volume mount, must
  contain `.onnx`) exists or the cache dir is writable for online download.
  `/api/tts` returns `503` for `engine=kokoro` when unavailable; the frontend
  then falls back to `edge`. `GET /api/tts` probes availability so `TtsPlayer`
  shows the 🎧 本地语音 option only when it actually works.
- **Asset self-healing.** `ensureRuntimeAssets()` copies `espeak-ng.wasm` and
  downloads the eight `voices/*.bin` files at first load if missing — both are
  hard-coded Node-side paths in kokoro-js-zh that cannot be configured.
- **hf-mirror default.** transformers.js 3.x does not read the `HF_ENDPOINT`
  env var; `env.remoteHost` is set in code, defaulting to `https://hf-mirror.com`
  (reachable from CN networks; `KOKORO_HF_ENDPOINT` overrides for overseas).
  Model downloads cache to `/app/data/.kokoro-cache`.
- **White-list gating.** Only the eight Chinese voices are exposed
  (`web/lib/kokoro.ts`); English voices are deliberately excluded per the
  product requirement 不要英文语音.
- **One-command server enablement.** `rebuild.sh` **enables local TTS by
  default**: it builds with `ENABLE_LOCAL_TTS=1`, downloads the q8 weights into
  `./models/kokoro/` (skipped entirely when `onnx/model_quantized.onnx` already
  exists — zero network requests), and runs `npm run test:tts-local` inside the
  container after startup. `--no-tts` / `--no-model` are the escape hatches
  (Edge-only image, or skip the model download). The engine only loads
  `onnx/model_quantized.onnx`: transformers.js defaults `subfolder='onnx'` and
  maps dtype `q8` to the `_quantized` suffix. The conditional npm install sets
  **two** env vars, `ONNXRUNTIME_NODE_INSTALL=skip` and
  `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`: onnxruntime-node bundles the Linux x64
  CPU binary in the npm package, and its install script would otherwise try to
  fetch unbundled CUDA/GPU binaries (NuGet/GitHub 302 redirect with no mirror
  support — fails on CN networks); CPU inference needs none of that, so the
  download is skipped entirely (no `ONNX_BINARY_MIRROR` build-arg exists). Both
  vars are required because `@huggingface/transformers@3.8.1` hard-pins
  `onnxruntime-node@1.21.0` (exact version), which npm nests under
  `node_modules/@huggingface/transformers/`; that 1.21.0 copy's legacy install
  script reads only the `_CUDA` var (the new one is 1.29+-only), and without it
  still tries to download the GPU tgz from GitHub.

## Alternatives considered

**Use original `kokoro-js` 1.2.1.** Verified experimentally: its voice
whitelist is hard-coded to 28 English voices and `list_voices()` returns
nothing usable; Node voice loading reads only the packaged `../voices/*.bin`;
`phonemizer` 1.2.1 rejects `cmn`/`zh` ("Invalid language identifier"). It
cannot synthesize Chinese at all — rejected on the hard requirement.

**Use `onnx-community/Kokoro-82M-v1.1-zh-ONNX`.** Its `voices/` directory holds
numbered files (`zf_001.bin`…) that do not match kokoro-js-zh's named voice
lookup, and the fork's own README pairs `zf_*` voices with the v1.0-ONNX model.
Verified working with v1.0-ONNX — chosen.

**Ship voice files in the image only.** Offline builds still work: the Docker
`RUN` block pre-downloads them but tolerates failure with a WARN, and runtime
`ensureRuntimeAssets()` downloads them at first use. This avoids hard build
failures on restricted networks.

## Consequences

- Listen-back gains a fully offline Chinese engine; Edge remains the fallback
  when the dependency is not installed (`ENABLE_LOCAL_TTS=0`), no model is
  mounted, or assets cannot be fetched.
- Default images (`ENABLE_LOCAL_TTS=0`) are unchanged in size and build time;
  Next.js builds pass both with and without the packages installed
  (package names referenced only via variables + `webpackIgnore` so the
  default build never resolves them).
- Model weights never enter the image: mount `./models/kokoro` (compose) or
  rely on the persistent online cache. Empty mount = not enabled = Edge.
- Verified locally: `npm run typecheck` green; `npm run test:tts-local`
  synthesizes real Chinese WAV (RIFF-validated, ~7s for a short paragraph);
  Next.js production build passes in both package-present and package-absent
  scenarios. Full `docker compose build --build-arg ENABLE_LOCAL_TTS=1` must
  be run on a host with Docker (not available in this workspace).
