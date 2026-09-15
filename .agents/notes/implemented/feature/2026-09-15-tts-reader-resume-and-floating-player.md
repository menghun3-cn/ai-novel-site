# Agent Note: TTS listen-back resilience — floating mini-player, auto-retry, resume-from-breakpoint

Status: implemented

English | [中文](2026-09-15-tts-reader-resume-and-floating-player.zh.md)

## Problem

Two listen-back (听书) pain points surfaced after the V10.8 engine consolidation
(`edge` + `native` only, see
[edge-tts-custom-domain-kokoro-removal](../../implemented/simplification/2026-09-15-edge-tts-custom-domain-kokoro-removal.md)):

1. **Controls scroll away.** The full control panel (`web/components/TtsPlayer.tsx`)
   sits above the article. During playback the page auto-scrolls to follow the
   highlighted paragraph (`scrollIntoView` on the active paragraph), so the panel
   leaves the viewport within a few sentences — pausing or stopping required
   scrolling back to the top of the page.
2. **Synthesis interruption was fatal and unrecoverable.** Any failure — 5xx /
   network error / 20 s timeout / **an HTTP 200 with empty or truncated audio**
   (upstream stream cut mid-synthesis) or a corrupt blob that failed in
   `audio.onerror` / `audio.play()` — called the full `stop()` path, which cleared
   `edgeQueueRef`, `edgeIdxRef`, and the prefetch buffers. The only recovery was
   restarting playback from the beginning of the chapter, and only the
   still-in-flight `fetchEdgeAudio` retried (5xx/network); corrupt-audio
   playback failures never retried.

## Decision

`web/components/TtsPlayer.tsx` gains a **floating mini-player** and a
**suspend-with-breakpoint** failure model, with a pure backoff helper in
`web/lib/tts.ts`:

- **Floating mini-player (bottom pill).** A scroll/rAF listener tracks whether the
  control panel has left the viewport (`panelOutOfView`). While a session is
  active (`isPlaying || paused || interrupted || edgeBusy`) and the panel is out
  of view, a fixed bottom-center pill renders: play/pause, stop, and a live status
  line (正在听书 第 x/y 段 / 正在合成 / 自动重试中 / 已暂停 / 播放中断可续播).
  Clicking the pill body scrolls smoothly back to the panel with a sticky-header
  height compensation (`HEADER_OFFSET = 104`). Safe-area inset is respected via
  inline `padding-bottom: max(0.75rem, env(safe-area-inset-bottom))`.
- **Playback-layer auto-retry.** `playEdgeChunk` wraps fetch+play in a retry loop
  (up to `EDGE_AUTO_RETRY = 2` retries) with exponential backoff
  (`edgeRetryDelayMs(n) = 1200 × 2^(n−1)` in `web/lib/tts.ts`, tested by
  `verify-tts-reader`). It covers synthesis failures, **zero-byte audio is now a
  retryable transient failure inside `fetchEdgeAudio`**, corrupt-audio
  `audio.onerror`, and `audio.play()` rejections. `NotAllowedError` (autoplay
  policy) still suspends immediately with an actionable message — auto-retry
  cannot fix a missing user gesture. Retry progress is visible
  (「合成中断,正在自动重试(第 n/2 次)…」), and the backoff wait aborts if the user
  pauses or stops (`edgeActiveRef` flips false).
- **Suspend-with-breakpoint instead of full stop.** When retries are exhausted the
  player enters an `interrupted` state: the queue, current chunk index, and
  prefetch buffers are **retained** (`suspendSession` only stops the active audio
  and clears busy indicators). 继续 / 重试 (`play`) then resumes
  `playEdgeChunk(edgeIdxRef.current)` from the current chunk. The native engine
  keeps `unitsRef`/`idxRef` and resumes from `idxRef` on error. Only an explicit
  停止 resets everything. Pausing during a retry backoff abandons the retry; a
  later resume re-synthesizes the current chunk.
- The panel's 重试 button and button labels understand the new state
  (`paused || interrupted` → 继续).

## Alternatives considered

- **Stick the full control panel to the top (吸顶).** Rejected: the panel is
  2–3 rows tall (engine, voice, rate, status), which would cover reading height
  on mobile, and the site header is already `sticky top-0 z-20` — stacking two
  sticky bars fights for layout. A compact floating pill that appears only while
  a session is active avoids both problems and matches the mainstream listening
  pattern (微信读书/番茄小说/music-app mini-player).
- **Single floating round button (FAB).** Rejected: hides progress/status and
  forces an extra tap to reach stop; the pill carries play/pause + stop + status
  in one control.
- **Fail fast, keep the error, require a manual 重试 (status quo).** Rejected:
  the user explicitly reported that interruption without auto-retry makes the
  feature feel broken; transient upstream flakiness should not require a manual
  click. Auto-retry with bounded backoff and visible progress is the middle
  ground.
- **Resume by re-running `startEdge` from a saved paragraph index.** Rejected:
  re-slicing and re-fetching from the paragraph loses sentence-level chunk
  continuity; keeping `edgeQueueRef`/`edgeIdxRef` resumes at the exact chunk and
  reuses prefetched buffers.

## Consequences

- While a session is active and the panel is out of view, a bottom pill overlays
  the viewport; it disappears when the panel scrolls back into view or the
  session ends (停止 hides it; short articles that never scroll never show it).
- Failures now take up to ~3.6 s of backoff plus the inner `fetchEdgeAudio`
  retries before surfacing; the 「可续播」 state's worst-case latency is longer
  than a fail-fast stop, so the status line explicitly shows 正在自动重试 to stay
  honest.
- `interrupted` is cleared by any resume path, by 停止, and by engine switches;
  a deliberate pause never gets overridden by an in-flight retry (pause kills
  the backoff wait via `edgeActiveRef`).
- Mid-chunk pause→resume still resumes at the audio element's `currentTime` when
  the element survives the pause; if a pause lands during a retry backoff (no
  element yet), resume re-synthesizes and restarts the current sentence chunk —
  never the chapter.
- Error hints were reworded to point at 继续 (resume) as the recovery action.
- Verification: `npm run typecheck -w web` green; `npm run test:tts-reader`
  16/16 (two new assertions pin the backoff schedule). Shared bindings and state
  (`web/lib/tts.ts` helper) are the only cross-file change; no engine contract,
  API shape, or storage format changed, and no prior Agent Note is superseded.
