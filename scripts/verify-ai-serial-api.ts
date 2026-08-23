/**
 * V5 AI 连载管理端点验证:配置 GET/PUT 校验、批量入队、手动处理队列、任务列表。
 * 直调 Next 路由处理器;mock OpenAI 上游(node:http),零真网。
 *
 * 运行:npm run test:ai-serial-api
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-serial-api-'));
process.env.ADMIN_TOKEN = 't';

const { createBook, setLlmSettings } = await import('@novel/core');

function req(method: string, url: string, body?: unknown, token = 't'): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let failed = 0;
async function assertJson(res: Response, status: number, name: string): Promise<Record<string, unknown>> {
  const okStatus = res.status === status;
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {}
  console.log(`${okStatus ? '✓' : '✗'} ${name}(status=${res.status})`);
  if (!okStatus) failed++;
  return data;
}
function assertOk(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed++;
}

// ---------- mock 上游 ----------
const server = http.createServer((req2, res) => {
  if (req2.method === 'GET' && req2.url?.includes('/models')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'embed-mock' }, { id: 'api-chat-mock' }] }));
    return;
  }
  let raw = '';
  req2.on('data', (c) => (raw += c));
  req2.on('end', () => {
    void raw;
    const bodyText = Array.from({ length: 40 }, (_, i) => `第${i}段:夜色如潮水漫过第${i}座塔楼,灯火次第亮起又熄灭。`).join('');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: `# 章回\n\n${bodyText}` } }] }));
  });
});
await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
const addr = server.address();
if (!addr || typeof addr === 'string') throw new Error('no port');
setLlmSettings({ baseUrl: `http://127.0.0.1:${addr.port}`, apiKey: 'test-key' });

const book = createBook({ slug: 'serial-api', title: '连载API之书', authorName: '测', categoryName: '科幻', tags: [] });

const { GET: configGet, PUT: configPut } = await import('../web/app/api/admin/books/[id]/ai-serialization/route');
const { POST: enqueuePost } = await import('../web/app/api/admin/ai/serial/enqueue/route');
const { POST: runPost } = await import('../web/app/api/admin/ai/serial/run/route');
const { GET: jobsGet } = await import('../web/app/api/admin/ai/serial/jobs/route');

// ---------- 配置端点 ----------
{
  const g1 = await assertJson(await configGet(req('GET', `/api/admin/books/${book.id}/ai-serialization`), { params: Promise.resolve({ id: book.id }) }), 200, 'GET 配置(虚拟默认)');
  const cfg1 = g1.config as { enabled: boolean; hour: number };
  assertOk(!cfg1.enabled && cfg1.hour === 8, '默认:停用/8点');

  const bad = await assertJson(await configPut(req('PUT', `/api/admin/books/${book.id}/ai-serialization`, { hour: 24 }), { params: Promise.resolve({ id: book.id }) }), 400, 'PUT hour=24 → 400');
  assertOk(typeof (bad as { error?: string }).error === 'string' && (bad as { error?: string }).error.length > 0, `拒绝并带错误码(${(bad as { error?: string }).error})`);

  const put = await assertJson(await configPut(req('PUT', `/api/admin/books/${book.id}/ai-serialization`, { enabled: true, hour: 6, count: 3, autoPublish: true, minChars: 300 }), { params: Promise.resolve({ id: book.id }) }), 200, 'PUT 合法配置');
  const cfg2 = put.config as { enabled: boolean; autoPublish: boolean };
  assertOk(cfg2.enabled && cfg2.autoPublish, '保存并回显');

  const noAuth = await configGet(new Request('http://x'), { params: Promise.resolve({ id: book.id }) });
  assertOk(noAuth.status === 401 || noAuth.status === 503, `无令牌 → ${noAuth.status}`);
}

// ---------- 入队/处理/列表 ----------
{
  const badEnq = await assertJson(await enqueuePost(req('POST', '/api/admin/ai/serial/enqueue', { bookId: book.id, count: 51 })), 400, '入队 count=51 → 400');
  assertOk(typeof (badEnq as { error?: string }).error === 'string' && (badEnq as { error?: string }).error.length > 0, `拒绝并带错误码(${(badEnq as { error?: string }).error})`);

  const enq = await assertJson(await enqueuePost(req('POST', '/api/admin/ai/serial/enqueue', { bookId: book.id, count: 2 })), 200, '批量入队 2 个');
  assertOk(Array.isArray(enq.jobs) && (enq.jobs as unknown[]).length === 2, '返回任务数组');

  // 鉴权缺失
  const unauthRun = await runPost(new Request('http://localhost/api/admin/ai/serial/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }));
  assertOk(unauthRun.status === 401 || unauthRun.status === 503, `run 无令牌 → ${unauthRun.status}`);

  const run = await assertJson(await runPost(req('POST', '/api/admin/ai/serial/run', { limit: 10 })), 200, '手动处理队列');
  assertOk(run.processed === 2, `处理 2 个(实得 ${run.processed})`);
  const jobs = run.jobs as Array<{ status: string; chapterNumber: number | null }>;
  assertOk(jobs.length >= 2 && jobs.slice(0, 2).every((j) => j.status === 'published'), 'autoPublish=true → 两任务 published');
  assertOk(jobs[0].chapterNumber === 1 || jobs[1].chapterNumber === 1, '章号从 1 开始连续分配');

  const list = await assertJson(await jobsGet(req('GET', `/api/admin/ai/serial/jobs?bookId=${book.id}&limit=10`)), 200, '任务列表(按书过滤)');
  assertOk((list.jobs as unknown[]).length === 2, '过滤后恰好 2 条');
}

server.close();
server.closeAllConnections();
console.log(failed === 0 ? '\nAI 连载管理端点全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
