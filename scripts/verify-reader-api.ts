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

console.log(failed === 0 ? '\n读者认证端点全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
