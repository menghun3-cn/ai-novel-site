# Agent Note: Admin LLM settings

Status: implemented

English | [中文](2026-08-23-admin-llm-settings.md)

## Problem

LLM credentials lived only in environment variables: changing the gateway
required editing user/machine env and restarting processes, operators had no
way to see what was configured, and there was no way to verify connectivity
without curl. The roadmap's operator console needed a runtime-configurable
AI service.

## Decision

Three pieces:

1. **Storage** — new `app_settings` key/value table (DDL `IF NOT EXISTS`, no
   migration) plus `core/src/settings.ts`: `getLlmSettings()` returns the
   public view where the API key appears only as `apiKeyConfigured` +
   `apiKeyPreview` (`sk-…wxyz` mask, first 3 / last 4); `getLlmSecretConfig()`
   exposes plaintext **only for server-side merging**; `setLlmSettings(patch)`
   treats `undefined` as "unchanged" and `null`/empty-string as "clear".
2. **Resolver generalization** — ai-writer's env resolver became
   `resolveProvider({baseUrl, apiKey, model})`; `resolveProviderFromEnv` is a
   thin wrapper kept for compatibility. The generation route merges
   **admin settings first, env fallback** per field, so a partially filled
   admin config (e.g. base URL + key only, model empty for autodiscovery)
   still works. Model discovery cache keys on baseUrl+apiKey as before.
3. **UI + endpoints** — `/admin/settings` (**系统设置**, sidebar entry with
   Settings icon): Base URL input, password-style API Key input whose label
   shows the mask when configured (leave blank = keep), optional model input,
   plus two actions — 保存配置 and 测试连通. The test endpoint merges config
   exactly like generation does, runs discovery if needed, fires one minimal
   completion, and reports `{ok, model, sample}` or `{ok:false, code, message}`.
   The page badge states which source is active (后台配置 vs 环境变量回退).

Also in this PR (cosmetic but requested): the sidebar brand block now shows
the app version under the name, imported from `web/package.json`
(`v4.0.0`), so the deployed artifact self-identifies.

Verification: `npm run test:settings` (12 assertions: empty defaults, masking
shape, partial-update vs clear semantics, plaintext-only-internally, resolver
guards, DB-driven discovery+completion against a mock upstream, env fallback
when stored config cleared). CDP audit 12/12: nav entry, version under brand,
form prefill, save round-trip, masked-key label after configuring, persistence
across reloads, and 测试连通 succeeding end-to-end through the stored config
with **no AI_* env vars present in the server process**. Finally, a real
gateway smoke (user-provided base URL/key) completed through the stored path:
discovery picked the first eligible model and a live completion returned.
typecheck and production build pass.

## Alternatives considered

**Env vars only.** Lost: restart-per-change and zero operator visibility;
the user explicitly asked to manage this from the console.

**Encrypt the key at rest.** Deferred: SQLite file already sits behind OS
file permissions; symmetric encryption would just move the secret into
another env var. Revisit if the deployment story gains multi-tenant storage.

**Separate model-discovery endpoint.** Folded into 测试连通 instead: one
action answers both "are my credentials right" and "which model would be
used", which is what an operator actually wants to know.

## Consequences

Gained: gateway changes are now a form edit plus one click, verifiable
instantly; local dev no longer depends on machine-level env for AI. Cost:
the API key sits in plaintext inside `data/novel.db` — acceptable for a
single-operator deployment where the DB already holds all content, but it
means DB backups now contain credentials (treat them accordingly); also the
generation route reads settings per request (two indexed point queries, no
measurable cost at this scale).
