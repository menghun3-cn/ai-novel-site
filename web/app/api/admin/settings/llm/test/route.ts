import { getLlmSecretConfig, resolveProvider } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/**
 * LLM 连通性测试:按「后台配置 > 环境变量」合并解析,自动发现模型后发一次最小补全。
 * 返回 { ok, model?, code?, message? },不落任何数据。
 */
export const POST = withAdmin<AdminRouteContext>(async () => {
  const stored = getLlmSecretConfig();
  try {
    const provider = await resolveProvider({
      baseUrl: stored.baseUrl || process.env.AI_BASE_URL,
      apiKey: stored.apiKey || process.env.AI_API_KEY,
      model: stored.model || process.env.AI_MODEL,
    });
    const out = await provider.complete({ prompt: '连通测试:只回复两个字母 OK', maxTokens: 2000, temperature: 0 });
    return json({ ok: true, model: provider.name.replace('openai-compatible:', ''), sample: out.trim().slice(0, 40) });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return json({ ok: false, code: e.code ?? 'AI_PROVIDER_FAILED', message: String(e.message).slice(0, 300) });
  }
});
