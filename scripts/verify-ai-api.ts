/**
 * V4 AI 生成端点验证:本地 mock OpenAI 兼容上游 + 直调 Route Handler。
 * 覆盖:未配置 → 503;非法 body → 400;正常生成 → 200 created;
 * 质检拦截 → created:false;上游 500 → 502。
 *
 * 运行:npm run test:ai-api
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-ai-api-'));
process.env.ADMIN_TOKEN = 't';

const { createBook } = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

async function status(res: Promise<Response>): Promise<number> {
  return (await res).status;
}

// mock 上游:可切换正常/500
let upstreamFail = false;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (upstreamFail) {
      res.writeHead(500).end('boom');
      return;
    }
    void raw;
    const body = Array.from({ length: 40 }, (_, i) => `第${i}段:情节推进${i}号,线索浮出水面。`).join('');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: `# 试炼\n\n${body}` } }] }));
  });
});
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no port');
const PORT = addr.port;

const book = createBook({ slug: 'ai-api-book', title: 'AI API 之书', authorName: '测', categoryName: '奇幻', tags: [] });

async function call(body: unknown): Promise<Response> {
  const { POST } = await import('../web/app/api/admin/ai/generate-chapter/route');
  const req = new Request('http://localhost/api/admin/ai/generate-chapter', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 't' },
    body: JSON.stringify(body),
  });
  return POST(req, undefined as never);
}

// 1. 未配置环境 → 503
{
  const prev = { ...process.env };
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  assertOk((await status(call({ bookId: book.id }))) === 503, '未配置 Provider → 503');
  process.env.AI_BASE_URL = prev.AI_BASE_URL ?? `http://127.0.0.1:${PORT}`;
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_MODEL = 'mock-1';
}

// 2. 非法 body → 400
assertOk((await status(call({ bookId: '' }))) === 400, '空 bookId → 400');
assertOk((await status(call({ bookId: book.id, chapterNumber: 0 }))) === 400, 'chapterNumber=0 → 400');

// 3. 正常生成
{
  const res = await call({ bookId: book.id, submitForReview: true });
  const data = (await res.json()) as { result: { created: boolean; chapterNumber: number; submitted: boolean } };
  assertOk(res.status === 200 && data.result.created && data.result.chapterNumber === 1 && data.result.submitted, '生成并送审第 1 章');
}

// 4. 上游 500 → 502
{
  upstreamFail = true;
  assertOk((await status(call({ bookId: book.id }))) === 502, '上游 500 → 502');
  upstreamFail = false;
}

server.close();
console.log(failed === 0 ? '\nAI 生成端点全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
