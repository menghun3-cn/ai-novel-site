/**
 * 本地测试(临时脚本,不入库):读取用户级环境变量的 AI_BASE_URL/AI_API_KEY,
 * 写入本地库 app_settings(后台配置),然后经存储配置实测发现+补全。
 * 密钥绝不打印。
 */
const { setLlmSettings, getLlmSettings, getLlmSecretConfig, resolveProvider } = await import('@novel/core');

if (!process.env.SMOKE_BASE_URL || !process.env.SMOKE_API_KEY) {
  console.error('SMOKE_BASE_URL / SMOKE_API_KEY missing');
  process.exit(1);
}

// 写入后台配置(model 置空 → 自动发现)
setLlmSettings({ baseUrl: process.env.SMOKE_BASE_URL, apiKey: process.env.SMOKE_API_KEY, model: null });

const pub = getLlmSettings();
console.log(`[stored] baseUrl=${pub.baseUrl} apiKeyConfigured=${pub.apiKeyConfigured} preview=${pub.apiKeyPreview} model=${pub.model ?? '(自动发现)'}`);

const secret = getLlmSecretConfig();
const p = await resolveProvider({ ...secret });
console.log(`[resolved] provider=${p.name}`);

const t0 = Date.now();
const out = await p.complete({ prompt: '只回复四个字:链路畅通', maxTokens: 2000, temperature: 0 });
console.log(`[completion] ${JSON.stringify(out.trim().slice(0, 80))} (${Date.now() - t0}ms)`);

// 再验证生成端点同款合并逻辑读到的就是这份配置
console.log('[merge-check] generation route will use:', JSON.stringify(pub));
