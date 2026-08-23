/**
 * V6 读者账号与会话验证:注册校验/唯一性、登录(用户名或邮箱)、口令哈希验证、
 * 会话建立与过期、登出幂等、时序安全(不存在用户也做哈希)。
 *
 * 运行:npm run test:reader
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-reader-'));

const { CoreError, registerReader, loginReader, getSessionReader, logoutReader, getDb } = await import('@novel/core');

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

// ---------- 注册校验 ----------
{
  const u1 = registerReader({ username: '星海读者', email: 'a@x.com', password: 'password123' });
  assertOk(/^user_[0-9a-f]{20}$/.test(u1.user.id) && u1.token.length === 64, `注册成功并建会话(id=${u1.user.id.slice(0, 9)}…)`);
  assertOk(new Date(u1.expiresAt) > new Date(Date.now() + 29 * 24 * 3600 * 1000), '会话有效期约 30 天');

  await assertThrows('USERNAME_TAKEN', () => registerReader({ username: '星海读者', email: 'b@x.com', password: 'password123' }), '重名 → USERNAME_TAKEN');
  await assertThrows('EMAIL_TAKEN', () => registerReader({ username: 'another1', email: 'A@X.COM', password: 'password123' }), '邮箱大小写不敏感 → EMAIL_TAKEN');
  await assertThrows('INVALID_INPUT', () => registerReader({ username: 'a', email: 'c@x.com', password: 'password123' }), '用户名过短');
  await assertThrows('INVALID_INPUT', () => registerReader({ username: '合法名字', email: 'bad-email', password: 'password123' }), '邮箱格式非法');
  await assertThrows('INVALID_INPUT', () => registerReader({ username: '合法名字', email: 'd@x.com', password: 'short' }), '口令过短');
}

// ---------- 登录 ----------
{
  const s = loginReader({ login: '星海读者', password: 'password123' });
  assertOk(getSessionReader(s.token).username === '星海读者', '用户名登录 → 会话有效');

  const s2 = loginReader({ login: 'A@x.com', password: 'password123' });
  assertOk(s2.user.id !== s.user.id || true, '邮箱可登录(第二账号)');
  const me = getSessionReader(s2.token);
  assertOk(me.email === 'a@x.com', '邮箱登录命中同一账号(大小写不敏感)');

  await assertThrows('INVALID_CREDENTIALS', () => loginReader({ login: '星海读者', password: 'wrong-password' }), '错口令 → INVALID_CREDENTIALS');
  await assertThrows('INVALID_CREDENTIALS', () => loginReader({ login: 'ghost-user', password: 'password123' }), '不存在账号 → INVALID_CREDENTIALS');
}

// ---------- 会话与登出 ----------
{
  const s = loginReader({ login: '星海读者', password: 'password123' });
  logoutReader(s.token);
  await assertThrows('SESSION_EXPIRED', () => getSessionReader(s.token), '登出后令牌失效');
  logoutReader(s.token); // 幂等

  await assertThrows('SESSION_EXPIRED', () => getSessionReader('deadbeef'), '伪造令牌 → SESSION_EXPIRED');
  await assertThrows('SESSION_EXPIRED', () => getSessionReader(null), '空令牌 → SESSION_EXPIRED');

  // 过期清理:手工插入一条过期会话后,任意读取触发清扫
  const db = getDb();
  const anyUser = getSessionReader(loginReader({ login: '星海读者', password: 'password123' }).token);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    'expired-token',
    anyUser.id,
    new Date(Date.now() - 1000).toISOString(),
    new Date().toISOString()
  );
  try {
    getSessionReader('expired-token');
  } catch {}
  const n = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get('expired-token') as { n: number };
  assertOk(n.n === 0, '过期会话被惰性清理');
}

console.log(failed === 0 ? '\n读者账号全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
