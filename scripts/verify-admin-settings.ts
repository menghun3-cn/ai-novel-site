/**
 * V4 后台 LLM 设置验证:app_settings 读写与掩码、部分更新语义(undefined=不变/null=清除)、
 * resolveProvider 配置源参数化(后台配置优先于 env)、自动发现走后台配置。
 *
 * 运行:npm run test:settings
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-settings-'));

const {
  CoreError,
  getLlmSettings,
  getLlmSecretConfig,
  setLlmSettings,
  resolveProvider,
} = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}
async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

// ---------- 存储与掩码 ----------
{
  const empty = getLlmSettings();
  assertOk(empty.baseUrl === null && !empty.apiKeyConfigured && empty.apiKeyPreview === null, '初始为空且无掩码');

  const s1 = setLlmSettings({ baseUrl: 'https://api.example.com', apiKey: 'sk-abcdefghijklmnop', model: '' });
  assertOk(s1.baseUrl === 'https://api.example.com' && s1.apiKeyConfigured, '保存 baseUrl+Key');
  assertOk(s1.apiKeyPreview === 'sk-…mnop', `掩码只露首3尾4(实得 ${s1.apiKeyPreview})`);
  const secret = getLlmSecretConfig();
  assertOk(secret.apiKey === 'sk-abcdefghijklmnop', '服务端内部可取明文');

  const s2 = setLlmSettings({ model: 'deepseek-chat' });
  assertOk(s2.model === 'deepseek-chat' && s2.baseUrl !== null && s2.apiKeyConfigured, '部分更新:undefined 字段不变');

  const s3 = setLlmSettings({ model: null });
  assertOk(s3.model === null && s3.baseUrl !== null, 'null 清除单字段');
}

// ---------- resolveProvider 配置源 ----------
{
  await assertThrows('AI_NOT_CONFIGURED', () => resolveProvider({ baseUrl: null, apiKey: null }), '空配置 → AI_NOT_CONFIGURED');
  await assertThrows('AI_NOT_CONFIGURED', () => resolveProvider({ baseUrl: 'https://x', apiKey: '  ' }), '空白 Key → AI_NOT_CONFIGURED');
}

// ---------- 本地 mock 上游:验证后台配置驱动发现与补全 ----------
let chatCalls = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.includes('/models')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'text-embed-x' }, { id: 'stored-chat-model' }] }));
    return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    chatCalls++;
    void raw;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
});
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no port');
const MOCK_BASE = `http://127.0.0.1:${addr.port}`;

{
  // 后台配置(存 DB)→ 发现取第一个非 embed 模型 → 补全成功
  setLlmSettings({ baseUrl: MOCK_BASE, apiKey: 'stored-key' });
  const p = await resolveProvider({ ...getLlmSecretConfig(), model: process.env.AI_MODEL });
  assertOk(p.name === 'openai-compatible:stored-chat-model', `按后台配置自动发现(实得 ${p.name})`);
  const out = await p.complete({ prompt: 'ping' });
  assertOk(out === 'OK' && chatCalls === 1, '经后台配置补全成功');

  // 后台为空时回退 env(此处模拟 env 指向同一 mock 的另一凭据)
  setLlmSettings({ baseUrl: null, apiKey: null });
  const p2 = await resolveProvider({ baseUrl: process.env.AI_BASE_URL ?? MOCK_BASE, apiKey: process.env.AI_API_KEY ?? 'env-key', model: 'env-model' });
  assertOk(p2.name === 'openai-compatible:env-model', '后台清空后可用环境变量来源构造');
}

server.close();
console.log(failed === 0 ? '\n后台 LLM 设置全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
