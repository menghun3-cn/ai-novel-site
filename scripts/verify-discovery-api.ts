/**
 * V7 Discovery 端点验证:view/finish/stats/discovery 四件套(直调 Next 路由)。
 * 运行:npm run test:discovery-api
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-discovery-api-'));

function req(method: string, url: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: method === 'POST' ? '{}' : undefined,
  });
}

let failed = 0;
async function assertJson(res: Response, status: number, name: string): Promise<Record<string, unknown>> {
  const ok = res.status === status;
  let d: Record<string, unknown> = {};
  try {
    d = (await res.json()) as Record<string, unknown>;
  } catch {}
  console.log(`${ok ? '✓' : '✗'} ${name}(status=${res.status})`);
  if (!ok) failed++;
  return d;
}
function assertOk(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed++;
}

// 种子
const core = await import('@novel/core');
const { createChapter, submitChapterForReview, approveChapter, registerReader } = core;
const book = core.createBook({ slug: 'api-d-book', title: '端点热度书', authorName: '测', categoryName: '科幻', tags: [] });
for (const num of [1, 2]) {
  createChapter({ bookId: book.id, number: num, title: `第${num}章`, contentMd: `# 第${num}章\n\n` + '正文'.repeat(300) });
  submitChapterForReview(book.id, num);
  approveChapter(book.id, num, { mode: 'now' });
}
const slugCtx = { params: Promise.resolve({ slug: book.slug }) };
const chCtx = (n: number) => ({ params: Promise.resolve({ slug: book.slug, number: String(n) }) });

const { POST: viewPost } = await import('../web/app/api/books/[slug]/chapters/[number]/view/route');
const { POST: finishPost } = await import('../web/app/api/books/[slug]/chapters/[number]/finish/route');
const { GET: statsGetRoute } = await import('../web/app/api/books/[slug]/stats/route');
const { GET: discoveryRoute } = await import('../web/app/api/discovery/route');

// view / finish
{
  const nf = await viewPost(req('POST', '/x'), { params: Promise.resolve({ slug: 'no-such', number: '1' }) });
  assertOk(nf.status === 404, '未知书 PV → 404');

  await assertJson(await viewPost(req('POST', '/x'), chCtx(1)), 200, 'PV 上报');
  await assertJson(await viewPost(req('POST', '/x'), chCtx(1)), 200, 'PV 上报 x2');
  await assertJson(await finishPost(req('POST', '/x'), chCtx(1)), 200, '完读上报');

  const bad = await viewPost(req('POST', '/x'), chCtx(99));
  assertOk(bad.status === 404, '未发布章号 PV → 404');
}

// stats
{
  const st = await assertJson(await statsGetRoute(req('GET', '/x'), slugCtx), 200, '书籍统计');
  assertOk(st.viewCount === 2 && st.favoriteCount === 0 && st.publishedCount === 2, `PV=2 收藏=0(${JSON.stringify(st)})`);
  assertOk(typeof st.finishRate === 'number' && st.finishRate > 0, `完读率 ${st.finishRate} > 0`);
  const nf = await statsGetRoute(req('GET', '/x'), { params: Promise.resolve({ slug: 'no-such' }) });
  assertOk(nf.status === 404, '统计未知书 → 404');
}

// discovery:匿名无 foryou;登录有
{
  const anon = await assertJson(await discoveryRoute(req('GET', '/x')), 200, 'Discovery 匿名 feed');
  const keys = ((anon.sections as Array<{ key: string }>) ?? []).map((s) => s.key);
  assertOk(keys.includes('hot') && !keys.includes('foryou'), `匿名板块 ${keys.join('/')} 无 foryou`);

  const reg = registerReader({ username: 'api热度友', email: 'hot@x.com', password: 'password123' });
  const cookie = `reader_session=${reg.token}`;
  const authed = await assertJson(await discoveryRoute(req('GET', '/x', cookie)), 200, 'Discovery 登录 feed');
  const keys2 = ((authed.sections as Array<{ key: string }>) ?? []).map((s) => s.key);
  assertOk(keys2.includes('foryou'), `登录板块含 foryou(${keys2.join('/')})`);
}

console.log(failed === 0 ? '\nDiscovery 端点全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
