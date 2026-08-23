// 运行时配置存储:app_settings 键值表 + LLM 服务配置的读写与掩码
// 优先级约定:后台配置(DB)> 环境变量;API Key 只以掩码形式出服务层

import { getDb } from './db';

const KEY_BASE_URL = 'ai.baseUrl';
const KEY_API_KEY = 'ai.apiKey';
const KEY_MODEL = 'ai.model';

function getRaw(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

function setRaw(key: string, value: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString());
}

function maskKey(key: string | null): string | null {
  if (!key) return null;
  const clean = key.trim();
  if (clean.length <= 8) return '••••';
  return `${clean.slice(0, 3)}…${clean.slice(-4)}`;
}

/** 后台展示用:Key 只回掩码与是否已配置 */
export interface LlmSettingsPublic {
  baseUrl: string | null;
  apiKeyConfigured: boolean;
  apiKeyPreview: string | null;
  model: string | null;
}

/** 服务端内部用(含明文 Key);只在合并环境变量时使用,不得出 API 响应 */
export interface LlmSecretConfig {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

export function getLlmSettings(): LlmSettingsPublic {
  const apiKey = getRaw(KEY_API_KEY);
  return {
    baseUrl: getRaw(KEY_BASE_URL),
    apiKeyConfigured: Boolean(apiKey),
    apiKeyPreview: maskKey(apiKey),
    model: getRaw(KEY_MODEL),
  };
}

export function getLlmSecretConfig(): LlmSecretConfig {
  return { baseUrl: getRaw(KEY_BASE_URL), apiKey: getRaw(KEY_API_KEY), model: getRaw(KEY_MODEL) };
}

/**
 * 部分更新:undefined = 不变;null = 清除该字段。
 * baseUrl 允许空串清除?统一约定:null/空串均视为清除。
 */
export function setLlmSettings(patch: {
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
}): LlmSettingsPublic {
  if (patch.baseUrl !== undefined) setRaw(KEY_BASE_URL, patch.baseUrl?.trim() || null);
  if (patch.apiKey !== undefined) setRaw(KEY_API_KEY, patch.apiKey?.trim() || null);
  if (patch.model !== undefined) setRaw(KEY_MODEL, patch.model?.trim() || null);
  return getLlmSettings();
}
