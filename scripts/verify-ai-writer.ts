/**
 * V4 AI Writer 引擎验证:Provider 适配器契约(用本地 http 服务模拟)、
 * 环境解析守卫、规则质检三规则、生成落稿/送审/复核暂扣、冲突与失败传播。
 *
 * 运行:npm run test:ai-writer
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-ai-'));

const {
  CoreError,
  createBook,
  createChapter,
  getChapterByNumber,
  createOpenAiCompatibleProvider,
  resolveProviderFromEnv,
  clearProviderCache,
  createFakeProvider,
  qualityCheckChapter,
  generateChapterDraft,
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

// ---------- 规则质检 ----------
{
  const varied = Array.from({ length: 40 }, (_, i) => `段落${i}:山风掠过隘口${i}号,少年握紧火种继续前行。`).join('');
  const good = qualityCheckChapter(varied);
  assertOk(good.ok, '达标正文通过质检');

  const short = qualityCheckChapter('太短');
  assertOk(!short.ok && short.issues[0].code === 'TOO_SHORT', `过短 → TOO_SHORT`);

  const marker = qualityCheckChapter('作为一个AI语言模型,我无法提供。' + varied);
  assertOk(!marker.ok && marker.issues.some((i) => i.code === 'AI_MARKERS'), 'AI 自述标记 → AI_MARKERS');

  const rep = qualityCheckChapter('山风吹过山谷吹过田野吹过河流'.repeat(160));
  assertOk(!rep.ok && rep.issues.some((i) => i.code === 'HIGH_REPETITION'), '高重复文本 → HIGH_REPETITION');
}

// ---------- 环境解析 ----------
{
  await assertThrows('AI_NOT_CONFIGURED', () => resolveProviderFromEnv({}), '环境缺失 → AI_NOT_CONFIGURED');
  const p = await resolveProviderFromEnv({ AI_BASE_URL: 'http://127.0.0.1:9/v1', AI_API_KEY: 'k', AI_MODEL: 'm' });
  assertOk(p.name === 'openai-compatible:m', '显式 AI_MODEL 时直接构造,不访问上游');
}

// ---------- 本地 HTTP 模拟 OpenAI 兼容端点(含 /models 自动发现) ----------
let modelList: string[] = ['text-embedding-mock', 'mock-chat', 'mock-vision'];
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.includes('/models')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: modelList.map((id) => ({ id })) }));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }>; model: string };
    if (!parsed.model || !Array.isArray(parsed.messages)) {
      res.writeHead(400).end('bad');
      return;
    }
    const userMsg = parsed.messages.find((m) => m.role === 'user')?.content ?? '';
    // 回显请求里的章节号,验证提示词真的传到了线上格式
    const m = /第 (\d+) 章/.exec(userMsg);
    // 模拟正文:逐句带唯一编号,避免触发滑窗重复质检
    const mockBody = Array.from({ length: 40 }, (_, i) => `第${i}段:山风掠过隘口${i}号哨位,少年握紧火种向第${i + 1}座烽台前行。`).join('');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [{ message: { content: `# 第${m?.[1] ?? '?'}章 试炼\n\n${mockBody}` } }],
      })
    );
  });
});
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no port');
const MOCK_BASE = `http://127.0.0.1:${addr.port}`;
const provider = createOpenAiCompatibleProvider({ baseUrl: MOCK_BASE, apiKey: 'test', model: 'fake-model' });

// ---------- 模型自动发现 ----------
{
  clearProviderCache();
  const p = await resolveProviderFromEnv({ AI_BASE_URL: MOCK_BASE, AI_API_KEY: 'test' });
  assertOk(p.name === 'openai-compatible:mock-chat', `无 AI_MODEL 时自动发现并跳过 embedding/vision(实得 ${p.name})`);
  const cached = await resolveProviderFromEnv({ AI_BASE_URL: MOCK_BASE, AI_API_KEY: 'test' });
  assertOk(cached.name === p.name, '同凭据二次解析命中缓存');
  clearProviderCache();
  modelList = ['text-embedding-mock', 'mock-rerank-v2'];
  await assertThrows('AI_NOT_CONFIGURED', () => resolveProviderFromEnv({ AI_BASE_URL: MOCK_BASE, AI_API_KEY: 'test' }), '列表无非对话模型 → AI_NOT_CONFIGURED');
  modelList = ['mock-chat', 'text-embedding-mock'];
  const first = await resolveProviderFromEnv({ AI_BASE_URL: MOCK_BASE, AI_API_KEY: 'test' });
  assertOk(first.name === 'openai-compatible:mock-chat', '取第一个符合条件的模型');
}

const book = createBook({ slug: 'ai-book', title: '火种纪元', authorName: '测', categoryName: '奇幻', tags: [] });

// 无大纲无近章的空书直接生成
{
  const r = await generateChapterDraft(book.id, { provider, minChars: 200 });
  assertOk(r.created && r.chapterNumber === 1 && r.quality.ok, '空书生成第 1 章');
  assertOk(r.title === '第1章 试炼', `标题取自模型一级标题(实得 ${r.created ? r.title : '?'})`);
  const ch = getChapterByNumber(book.id, 1);
  assertOk(ch?.status === 'draft' && !ch.contentMd.startsWith('#'), '落稿为 draft 且剥掉首行标题');
  assertOk((r as { promptChars?: number }).promptChars === undefined, '成功结果不携带 promptChars');
}

// 冲突守卫从组装器透传
await assertThrows('CHAPTER_NUMBER_CONFLICT', () => generateChapterDraft(book.id, { provider, chapterNumber: 1 }), '目标章已存在 → CHAPTER_NUMBER_CONFLICT');

// submitForReview 走状态机
{
  const r = await generateChapterDraft(book.id, { provider, minChars: 200, submitForReview: true });
  assertOk(r.created && r.submitted && getChapterByNumber(book.id, 2)?.status === 'pending_review', 'submitForReview → pending_review');
}

// LLM 复核 fail → 暂扣在 draft 并写 review_note
{
  const varied = (seed: number) => Array.from({ length: 40 }, (_, i) => `第${i}段:情节推进${seed}-${i}号,线索浮出水面。`).join('');
  const strictProvider = createFakeProvider((p) => (p.includes('审以下章节正文') ? 'FAIL\n节奏拖沓' : `# 第3章 试炼\n\n${varied(3)}`));
  const r = await generateChapterDraft(book.id, { provider: strictProvider, minChars: 200, submitForReview: true, llmReview: true });
  assertOk(r.created && !r.submitted && r.holdNote === '节奏拖沓', '复核 FAIL 暂扣,不自动送审');
  assertOk(getChapterByNumber(book.id, 3)?.status === 'draft', '暂扣章停在 draft');
  assertOk(getChapterByNumber(book.id, 3)?.reviewNote?.includes('LLM 复核暂扣') === true, 'review_note 记录暂扣原因');
}

// LLM 复核 pass → 正常送审
{
  const varied = (seed: number) => Array.from({ length: 40 }, (_, i) => `第${i}段:情节推进${seed}-${i}号,线索浮出水面。`).join('');
  const lenientProvider = createFakeProvider((p) => (p.includes('审以下章节正文') ? 'PASS\n合格' : `# 第4章 试炼\n\n${varied(4)}`));
  const r = await generateChapterDraft(book.id, { provider: lenientProvider, minChars: 200, submitForReview: true, llmReview: true });
  assertOk(r.created && r.submitted && r.llmReview?.verdict === 'pass', '复核 PASS 正常送审');
}

// 质检拦截:模型输出过短时不落稿
{
  const lazyProvider = createFakeProvider(() => '太短了');
  const r = await generateChapterDraft(book.id, { provider: lazyProvider, minChars: 200 });
  assertOk(!r.created && r.reason === 'quality' && r.quality.issues[0].code === 'TOO_SHORT', '过短输出被拦截且不落稿');
  assertOk(r.promptChars > 0, '拦截结果带 promptChars 供排查');
  assertOk(getChapterByNumber(book.id, 5) === null, '被拦截章号未占用');
}

// Provider 网络失败 → AI_PROVIDER_FAILED
{
  const dead = createOpenAiCompatibleProvider({ baseUrl: 'http://127.0.0.1:9', apiKey: 'x', model: 'x' });
  await assertThrows('AI_PROVIDER_FAILED', () => generateChapterDraft(book.id, { provider: dead }), '网络失败 → AI_PROVIDER_FAILED');
}

server.close();

console.log(failed === 0 ? '\nAI Writer 引擎全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
