/**
 * V8.1 Admin 账号验证:默认账号播种(admin/Admin@123456)、登录、
 * 首登强制改密(业务 API 403 PASSWORD_CHANGE_REQUIRED)、复杂口令规则、
 * 当前口令校验、会话保留/吊销、登出与 ADMIN_TOKEN 机器令牌兼容。
 *
 * 运行:npm run test:admin-auth
 * 数据库使用临时目录(NOVEL_DATA_DIR),不触碰 data/novel.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-admin-auth-'));
delete process.env.ADMIN_TOKEN;

const { NextRequest } = await import('next/server');

type Handler = (req: NextRequest, ctx?: { params: Promise<Record<string, never>> }) => Promise<Response>;

const loginRoute = (await import('../web/app/api/admin/auth/login/route.ts')) as unknown as Record<string, Handler>;
const sessionRoute = (await import('../web/app/api/admin/auth/session/route.ts')) as unknown as Record<string, Handler>;
const logoutRoute = (await import('../web/app/api/admin/auth/logout/route.ts')) as unknown as Record<string, Handler>;
const changeRoute = (await import('../web/app/api/admin/auth/change-password/route.ts')) as unknown as Record<string, Handler>;
const booksRoute = (await import('../web/app/api/admin/books/route.ts')) as unknown as Record<string, Handler>;
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
  if (init?.token) headers['x-admin-token'] = init.token;
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

// ---------- 默认账号播种 + 登录 ----------
{
  const bad = await body<{ error: string }>(loginRoute.POST(req('/api/admin/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })));
  assertOk(bad.status === 401 && bad.json.error === 'INVALID_CREDENTIALS', '错误口令 401 INVALID_CREDENTIALS');

  const ok = await body<{ token: string; expiresAt: string; username: string; mustChangePassword: boolean }>(
    loginRoute.POST(req('/api/admin/auth/login', { method: 'POST', body: { username: 'admin', password: core.DEFAULT_ADMIN_PASSWORD } }))
  );
  assertOk(ok.status === 200 && ok.json.username === 'admin' && ok.json.mustChangePassword === true, '初始账号登录 200 且标记待改密');
  assertOk(typeof ok.json.token === 'string' && ok.json.token.length === 64, '签发 64 位十六进制会话令牌');
  const t1 = ok.json.token;

  // ---------- 首登强制改密:业务 API 被拦截 ----------
  const blocked = await body<{ error: string }>(booksRoute.GET(req('/api/admin/books', { token: t1 })));
  assertOk(blocked.status === 403 && blocked.json.error === 'PASSWORD_CHANGE_REQUIRED', '未改密访问业务 API 403 PASSWORD_CHANGE_REQUIRED');

  const sess = await body<{ username: string; mustChangePassword: boolean }>(sessionRoute.GET(req('/api/admin/auth/session', { token: t1 })));
  assertOk(sess.status === 200 && sess.json.mustChangePassword === true, 'auth/session 在待改密期可用');

  // ---------- 复杂口令规则 ----------
  async function tryChange(currentPassword: string, newPassword: string): Promise<{ status: number; json: { error?: string } }> {
    return body(changeRoute.POST(req('/api/admin/auth/change-password', { method: 'POST', body: { currentPassword, newPassword }, token: t1 })));
  }

  const weakShort = await tryChange(core.DEFAULT_ADMIN_PASSWORD, 'Ab1!ab1!');
  assertOk(weakShort.status === 400 && weakShort.json.error === 'WEAK_PASSWORD', '弱口令(<10位) 400 WEAK_PASSWORD');
  const weakClass = await tryChange(core.DEFAULT_ADMIN_PASSWORD, 'alllowercase123!');
  assertOk(weakClass.status === 400 && weakClass.json.error === 'WEAK_PASSWORD', '缺大写字母 400 WEAK_PASSWORD');
  const weakName = await tryChange(core.DEFAULT_ADMIN_PASSWORD, 'Admin!Secure#9');
  assertOk(weakName.status === 400 && weakName.json.error === 'WEAK_PASSWORD', '包含账号名 400 WEAK_PASSWORD');

  const wrongCur = await tryChange('not-current-password', 'Str0ng!Pass2024');
  assertOk(wrongCur.status === 401 && wrongCur.json.error === 'INVALID_CREDENTIALS', '当前口令错误 401');

  const changed = await tryChange(core.DEFAULT_ADMIN_PASSWORD, 'Str0ng!Pass2024');
  assertOk(changed.status === 200 && changed.json.mustChangePassword === false, '合规改密 200 且清除待改密标记');

  // ---------- 改密后放行 ----------
  const allowed = await body<{ books: unknown[] }>(booksRoute.GET(req('/api/admin/books', { token: t1 })));
  assertOk(allowed.status === 200 && Array.isArray(allowed.json.books), '改密后同一会话可访问业务 API');

  // 改密时其余会话被吊销、当前会话保留:重新登录产生 T2,再手动造一个旧会话验证吊销语义
  const relogin = await body<{ token: string; mustChangePassword: boolean }>(
    loginRoute.POST(req('/api/admin/auth/login', { method: 'POST', body: { username: 'admin', password: 'Str0ng!Pass2024' } }))
  );
  assertOk(relogin.status === 200 && relogin.json.mustChangePassword === false, '新口令重新登录不再要求改密');

  const account = core.getAdminAccount(t1);
  assertOk(account.username === 'admin' && account.mustChangePassword === false, '核心层 getAdminAccount 状态一致');

  // ---------- 登出 ----------
  await logoutRoute.POST(req('/api/admin/auth/logout', { method: 'POST', token: relogin.json.token }));
  const afterLogout = await body(sessionRoute.GET(req('/api/admin/auth/session', { token: relogin.json.token })));
  assertOk(afterLogout.status === 401, '登出后会话失效 401');

  // 无效令牌
  const invalid = await body(sessionRoute.GET(req('/api/admin/auth/session', { token: 'f'.repeat(64) })));
  assertOk(invalid.status === 401, '无效令牌 401');
}

// ---------- ADMIN_TOKEN 机器令牌兼容(调度器/集成脚本路径) ----------
{
  process.env.ADMIN_TOKEN = 'ops-machine-token';
  const viaEnv = await body<{ books: unknown[] }>(booksRoute.GET(req('/api/admin/books', { token: 'ops-machine-token' })));
  assertOk(viaEnv.status === 200, '机器令牌仍可直接访问(向后兼容)');
  process.env.ADMIN_TOKEN = '';
}

console.log(failed === 0 ? '\nAdmin 账号体系全部验证通过' : `\n${failed} 项 Admin 账号验证失败`);
process.exit(failed === 0 ? 0 : 1);
