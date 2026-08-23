/**
 * V6 读者认证端点验证:注册/登录/登出/me 四件套,Cookie 下发与清除。
 * 直调 Next 路由处理器(NextResponse.cookies 可从 Set-Cookie 头读回)。
 *
 * 运行:npm run test:reader-api
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-reader-api-'));

function req(method: string, url: string, body?: unknown, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionCookieOf(res: Response): string | null {
  const cookies = res.headers.getSetCookie?.() ?? [];
  const c = cookies.find((x) => x.startsWith('reader_session='));
  if (!c) return null;
  return c.split(';')[0];
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

const { POST: registerRoute } = await import('../web/app/api/auth/register/route');
const { POST: loginRoute } = await import('../web/app/api/auth/login/route');
const { POST: logoutRoute } = await import('../web/app/api/auth/logout/route');
const { GET: meRoute } = await import('../web/app/api/auth/me/route');

// ---------- 注册 ----------
{
  const bad = await assertJson(await registerRoute(req('POST', '/api/auth/register', { username: 'x', email: 'bad', password: '1' })), 400, '非法注册体 → 400');
  assertOk(bad.error === 'VALIDATION_FAILED', 'zod 校验错误码');

  const ok = await assertJson(await registerRoute(req('POST', '/api/auth/register', { username: '书友甲', email: 'jia@x.com', password: 'password123' })), 200, '合法注册');
  const user = ok.user as { username: string } | undefined;
  assertOk(user?.username === '书友甲', '返回用户视图');
  const setCookie = (await registerRoute(req('POST', '/api/auth/register', { username: '书友乙', email: 'yi@x.com', password: 'password123' }))).headers.getSetCookie();
  assertOk(setCookie.some((c) => c.startsWith('reader_session=') && c.includes('HttpOnly')), 'Set-Cookie httpOnly');

  const dup = await assertJson(await registerRoute(req('POST', '/api/auth/register', { username: '书友甲', email: 'other@x.com', password: 'password123' })), 409, '重名 → 409');
  assertOk(dup.error === 'USERNAME_TAKEN', 'USERNAME_TAKEN');
}

// ---------- 登录 / me / 登出 ----------
{
  const login = await loginRoute(req('POST', '/api/auth/login', { login: 'jia@x.com', password: 'password123' }));
  const cookie = sessionCookieOf(login);
  assertOk(login.status === 200 && Boolean(cookie), '邮箱登录并下发会话 Cookie');

  const me = await assertJson(await meRoute(req('GET', '/api/auth/me', undefined, cookie)), 200, 'me 携带 Cookie');
  assertOk((me.user as { email?: string })?.email === 'jia@x.com', 'me 返回当前读者');

  const anon = await assertJson(await meRoute(req('GET', '/api/auth/me')), 200, 'me 未登录');
  assertOk(anon.user === null, '未登录 → user:null(仍 200)');

  const wrong = await assertJson(await loginRoute(req('POST', '/api/auth/login', { login: '书友甲', password: 'wrong-pass' })), 401, '错口令 → 401');
  assertOk(wrong.error === 'INVALID_CREDENTIALS', 'INVALID_CREDENTIALS');

  const out = await logoutRoute(req('POST', '/api/auth/logout', undefined, cookie));
  const cleared = out.headers.getSetCookie().some((c) => c.startsWith('reader_session=;') || c.includes('Max-Age=0'));
  assertOk(out.status === 200 && cleared, '登出清 Cookie');

  const afterLogout = await assertJson(await meRoute(req('GET', '/api/auth/me', undefined, cookie)), 200, '登出后旧 Cookie 已失效');
  assertOk(afterLogout.user === null, '旧会话不可用');
}

// ---------- V6 个性化端点:favorite/subscribe/progress/shelf/history ----------
{
  const { GET: favGet, POST: favPost } = await import('../web/app/api/books/[slug]/favorite/route');
  const { GET: subGet, POST: subPost } = await import('../web/app/api/books/[slug]/subscribe/route');
  const { POST: progressPost } = await import('../web/app/api/books/[slug]/chapters/[number]/progress/route');
  const { GET: shelfGet } = await import('../web/app/api/me/shelf/route');
  const { GET: historyGet } = await import('../web/app/api/me/history/route');

  // 造一本带两章已发布的书
  const { createBook: cb, createChapter, submitChapterForReview, approveChapter } = await import('@novel/core');
  const book = cb({ slug: 'api-shelf-book', title: '端点书架之书', authorName: '测', categoryName: '科幻', tags: [] });
  for (const num of [1, 2]) {
    createChapter({ bookId: book.id, number: num, title: `第${num}章`, contentMd: '# t\n\n' + '正文'.repeat(300) });
    submitChapterForReview(book.id, num);
    approveChapter(book.id, num, { mode: 'now' });
  }
  const slugCtx = { params: Promise.resolve({ slug: book.slug }) };
  const chCtx = (n: number) => ({ params: Promise.resolve({ slug: book.slug, number: String(n) }) });
  const nfCtx = { params: Promise.resolve({ slug: 'no-such-slug' }) };

  // 未登录一律 401
  assertOk((await favPost(req('POST', '/x'), slugCtx)).status === 401, '未登录收藏 → 401');
  assertOk((await shelfGet(req('GET', '/x'))).status === 401, '未登录书架 → 401');

  // 用注册会话
  const reg = await registerRoute(req('POST', '/api/auth/register', { username: '书友丙', email: 'bing@x.com', password: 'password123' }));
  const cookie = sessionCookieOf(await loginRoute(req('POST', '/api/auth/login', { login: 'bing@x.com', password: 'password123' })));
  void reg;

  const st1 = await assertJson(await favGet(req('GET', '/x', undefined, cookie), slugCtx), 200, '收藏状态(未收藏)');
  assertOk(st1.favorited === false, '初始未收藏');
  const tog = await assertJson(await favPost(req('POST', '/x', undefined, cookie), slugCtx), 200, '切换收藏');
  assertOk(tog.favorited === true, '收藏 → true');
  await assertJson(await favPost(req('POST', '/x', undefined, cookie), slugCtx), 200, '');
  const nfFav = await favGet(req('GET', '/x', undefined, cookie), nfCtx);
  assertOk(nfFav.status === 404, '未知 slug → 404 BOOK_NOT_FOUND');

  await assertJson(await subPost(req('POST', '/x', undefined, cookie), slugCtx), 200, '订阅');
  const subState = await assertJson(await subGet(req('GET', '/x', undefined, cookie), slugCtx), 200, '订阅状态');
  assertOk(subState.subscribed === true, '已订阅');

  await assertJson(await progressPost(req('POST', '/x', {}, cookie), chCtx(1)), 200, '上报进度 第1章');
  const badCh = await progressPost(req('POST', '/x', {}, cookie), chCtx(99));
  assertOk(badCh.status === 404, '未发布章号进度 → 404 CHAPTER_NOT_FOUND');

  const shelf = await assertJson(await shelfGet(req('GET', '/x', undefined, cookie)), 200, '我的书架');
  const entries = shelf.entries as Array<{ title: string; hasUpdate: boolean; progressChapter: number | null }>;
  assertOk(entries.length === 1 && entries[0].title === '端点书架之书' && entries[0].progressChapter === 1, '书架含进度条目');

  await assertJson(await progressPost(req('POST', '/x', {}, cookie), chCtx(2)), 200, '上报进度 第2章');
  const shelf2 = (await (await shelfGet(req('GET', '/x', undefined, cookie))).json()) as { entries: Array<{ hasUpdate: boolean }> };
  assertOk(shelf2.entries[0].hasUpdate === false, '追平最新 → 无更新提示');

  const hist = await assertJson(await historyGet(req('GET', '/x?limit=10', undefined, cookie)), 200, '阅读历史');
  const items = hist.items as Array<{ chapterNumber: number }>;
  assertOk(items.length === 1 && items[0].chapterNumber === 2, '历史为最近章(#2)');
}

console.log(failed === 0 ? '\n读者认证端点全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
