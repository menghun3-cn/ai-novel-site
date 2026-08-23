/**
 * V3 发布 API 验证:直接以函数方式调用 Route Handler,
 * 覆盖审核动作(submit/approve/reject)、待审核队列、自动发布配置、
 * 手动发布周期,以及错误映射(400/404/409)。
 *
 * 运行:npm run test:publish-api
 * 数据库使用临时目录(NOVEL_DATA_DIR),不触碰 data/novel.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-publish-api-'));
process.env.ADMIN_TOKEN = 'test-token-123';

const { NextRequest } = await import('next/server');

type Handler = (req: NextRequest, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

const booksRoute = (await import('../web/app/api/admin/books/route.ts')) as unknown as Record<string, Handler>;
const reviewRoute = (await import('../web/app/api/admin/books/[id]/chapters/[number]/review/route.ts')) as unknown as Record<string, Handler>;
const queueRoute = (await import('../web/app/api/admin/review-queue/route.ts')) as unknown as Record<string, Handler>;
const autopilotRoute = (await import('../web/app/api/admin/books/[id]/autopilot/route.ts')) as unknown as Record<string, Handler>;
const runRoute = (await import('../web/app/api/admin/publish/run/route.ts')) as unknown as Record<string, Handler>;
const core = await import('@novel/core');

let failed = 0;

function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

function req(path: string, init?: { method?: string; body?: unknown; token?: string | null }): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init?.token !== null) headers['authorization'] = `Bearer ${init?.token ?? 'test-token-123'}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  }) as NextRequest;
}

async function body<T>(p: Response | Promise<Response>): Promise<{ status: number; json: T }> {
  const res = await p;
  return { status: res.status, json: (await res.json()) as T };
}

function ctxNum(id: string, n: number): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id, number: String(n) }) };
}
function ctxId(id: string): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve({ id }) };
}

// ---------- 造数据 ----------
core.createBook({ slug: 'pub-api', title: '发布API之书', authorName: '星尘', categoryName: '科幻' });
const bid = 'book_pubapi';
for (let i = 1; i <= 4; i++) core.createChapter({ bookId: bid, title: `第${i}章`, contentMd: `正文 ${i}` });

// ---------- 鉴权 ----------
assertOk((await body(queueRoute.GET(req('/api/admin/review-queue', { token: null })))).status === 401, '无令牌访问队列 401');

// ---------- 审核动作 ----------
{
  const s = await body<{ chapter: { status: string } }>(
    reviewRoute.POST(req(`/api/admin/books/${bid}/chapters/1/review`, { method: 'POST', body: { action: 'submit' } }), ctxNum(bid, 1))
  );
  assertOk(s.status === 200 && s.json.chapter.status === 'pending_review', '送审 200');

  assertOk(
    (
      await body(
        reviewRoute.POST(req(`/api/admin/books/${bid}/chapters/2/review`, { method: 'POST', body: { action: 'approve', mode: 'now' } }), ctxNum(bid, 2))
      )
    ).status === 409,
    '未送审直接批准 409'
  );

  const missingField = await body(reviewRoute.POST(
    req(`/api/admin/books/${bid}/chapters/1/review`, { method: 'POST', body: { action: 'approve', mode: 'scheduled' } }),
    ctxNum(bid, 1)
  ));
  assertOk(missingField.status === 400, '定时批准缺 scheduledAt 400');

  const future = new Date(Date.now() + 3600_000).toISOString();
  const sched = await body<{ chapter: { status: string; scheduledAt: string } }>(
    reviewRoute.POST(
      req(`/api/admin/books/${bid}/chapters/1/review`, { method: 'POST', body: { action: 'approve', mode: 'scheduled', scheduledAt: future } }),
      ctxNum(bid, 1)
    )
  );
  assertOk(sched.status === 200 && sched.json.chapter.status === 'scheduled' && sched.json.chapter.scheduledAt === future, '定时批准 200');

  const badBody = await body(reviewRoute.POST(req(`/api/admin/books/${bid}/chapters/3/review`, { method: 'POST', body: {} }), ctxNum(bid, 3)));
  assertOk(badBody.status === 400, '非法请求体(缺 action) 400');

  const s3 = await body<{ chapter: { status: string } }>(
    reviewRoute.POST(req(`/api/admin/books/${bid}/chapters/3/review`, { method: 'POST', body: { action: 'submit' } }), ctxNum(bid, 3))
  );
  assertOk(s3.status === 200 && s3.json.chapter.status === 'pending_review', '第3章送审');

  const rj = await body<{ chapter: { status: string; reviewNote: string | null } }>(
    reviewRoute.POST(req(`/api/admin/books/${bid}/chapters/3/review`, { method: 'POST', body: { action: 'reject', note: '重写结尾' } }), ctxNum(bid, 3))
  );
  assertOk(rj.status === 200 && rj.json.chapter.status === 'draft' && rj.json.chapter.reviewNote === '重写结尾', '驳回留备注');

  const nf = await body(reviewRoute.POST(req(`/api/admin/books/${bid}/chapters/99/review`, { method: 'POST', body: { action: 'submit' } }), ctxNum(bid, 99)));
  assertOk(nf.status === 404, '未知章节 404');
}

// ---------- 待审核队列 ----------
{
  await reviewRoute.POST(req(`/api/admin/books/${bid}/chapters/4/review`, { method: 'POST', body: { action: 'submit' } }), ctxNum(bid, 4));
  const q = await body<{ items: { chapter: { number: number }; bookSlug: string; bookTitle: string }[] }>(queueRoute.GET(req('/api/admin/review-queue')));
  assertOk(
    q.status === 200 && q.json.items.length === 1 && q.json.items[0]!.chapter.number === 4 && q.json.items[0]!.bookSlug === 'pub-api',
    '队列含第4章且带书籍摘要'
  );
}

// ---------- 自动发布配置 ----------
{
  const g = await body<{ autopilot: { enabled: boolean; hour: number; count: number } }>(
    autopilotRoute.GET(req(`/api/admin/books/${bid}/autopilot`), ctxId(bid))
  );
  assertOk(g.status === 200 && !g.json.autopilot.enabled && g.json.autopilot.hour === 8 && g.json.autopilot.count === 1, 'GET 默认配置');

  const p = await body<{ autopilot: { enabled: boolean; hour: number; count: number } }>(
    autopilotRoute.PUT(req(`/api/admin/books/${bid}/autopilot`, { method: 'PUT', body: { enabled: true, hour: 8, count: 2 } }), ctxId(bid))
  );
  assertOk(p.status === 200 && p.json.autopilot.enabled && p.json.autopilot.count === 2, 'PUT 更新配置');

  const inv = await body<{ error: string }>(autopilotRoute.PUT(req(`/api/admin/books/${bid}/autopilot`, { method: 'PUT', body: { hour: 99 } }), ctxId(bid)));
  assertOk(inv.status === 400 && inv.json.error === 'VALIDATION_FAILED', 'hour=99 → 400(zod 前置拦截;服务层 INVALID_AUTOPILOT 为纵深防御)');

  const zod = await body(autopilotRoute.PUT(req(`/api/admin/books/${bid}/autopilot`, { method: 'PUT', body: { hour: 'x' } }), ctxId(bid)));
  assertOk(zod.status === 400, '类型非法 400(zod)');

  const missing = await body(autopilotRoute.GET(req('/api/admin/books/book_nope/autopilot'), ctxId('book_nope')));
  assertOk(missing.status === 404, '未知书 404');
}

// ---------- 手动发布周期 ----------
{
  // 第4章在队列中;先取回为 draft,再造成"已到期定时"状态等价于调度器面对的场景
  core.rejectChapter(bid, 4);
  const past = new Date(Date.now() - 60_000).toISOString();
  core.updateChapter(bid, 4, { status: 'scheduled', scheduledAt: past });

  const run = await body<{ result: { duePublished: number; autopilotBooks: number; autopilotPublished: number } }>(
    runRoute.POST(req('/api/admin/publish/run', { method: 'POST' }))
  );
  assertOk(run.status === 200 && run.json.result.duePublished >= 1, `手动周期触发发布(${JSON.stringify(run.json.result)})`);
  assertOk(core.getChapterByNumber(bid, 4)!.status === 'published', '到期章节已转 published');
}

console.log(failed === 0 ? '\n发布 API 全部验证通过' : `\n${failed} 项发布 API 验证失败`);
process.exit(failed === 0 ? 0 : 1);
