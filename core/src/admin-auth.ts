// V8.1 Admin 账号体系:库初始化即播种默认账号(admin/Admin@123456),
// 首次登录后强制修改为复杂密码才能访问业务管理 API。
// 口令哈希与读者侧一致:node:crypto scrypt(salt 随机 16B,格式 `scrypt:salt:hash`),无外部依赖。

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';
import {
  CoreError,
  type AdminAccount,
  type AdminSession,
  type ChangeAdminPasswordInput,
  type LoginAdminInput,
} from './domain';

/** 初始管理员账号:首次登录时展示于登录页提示,登录后立即要求改密 */
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'Admin@123456';

/** 管理会话有效期:短于读者会话(运营后台收紧到 24 小时) */
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 复杂口令规则:≥10 位且含小写/大写/数字/特殊字符,不含用户名 */
export function isStrongPassword(password: string, username: string): boolean {
  if (typeof password !== 'string' || password.length < 10) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/\d/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  if (username && password.toLowerCase().includes(username.toLowerCase())) return false;
  return true;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const actual = scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, 'hex');
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

interface AdminUserRow {
  id: string;
  username: string;
  password_hash: string;
  must_change_password: number;
  created_at: string;
  updated_at: string;
}

let seeded = false;

/**
 * 播种默认账号:admin_users 为空时插入 admin/Admin@123456(must_change_password=1)。
 * 幂等(进程内记忆一次);并发进程同时插入时依赖 username UNIQUE 兜底。
 */
export function ensureDefaultAdmin(): void {
  if (seeded) return;
  const db = getDb();
  const n = (db.prepare('SELECT COUNT(*) AS n FROM admin_users').get() as { n: number }).n;
  if (n === 0) {
    try {
      db.prepare(
        'INSERT INTO admin_users (id, username, password_hash, must_change_password, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
      ).run(`admin_${randomUUID().replace(/-/g, '').slice(0, 20)}`, DEFAULT_ADMIN_USERNAME, hashPassword(DEFAULT_ADMIN_PASSWORD), new Date().toISOString(), new Date().toISOString());
    } catch {
      /* 并发播种撞 UNIQUE:另一进程已建号,忽略 */
    }
  }
  seeded = true;
}

function db_findAdminByUsername(username: string): AdminUserRow | undefined {
  return getDb().prepare('SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE').get(username) as AdminUserRow | undefined;
}

/** 登录:校验用户名+口令;成功签发 24h 会话并返回是否仍需改密 */
export function loginAdmin(input: LoginAdminInput): AdminSession {
  ensureDefaultAdmin();
  const row = db_findAdminByUsername(input.username?.trim() ?? '');
  // 用户不存在时也做一次哈希计算,避免时序侧信道暴露账号存在性(与读者侧同策略)
  const stored = row?.password_hash ?? `scrypt:${randomBytes(16).toString('hex')}:${'0'.repeat(128)}`;
  const ok = verifyPassword(input.password ?? '', stored);
  if (!row || !ok) {
    throw new CoreError('INVALID_CREDENTIALS', 'invalid username or password');
  }
  return { ...createAdminSession(row.id), username: row.username, mustChangePassword: row.must_change_password === 1 };
}

/** 按令牌取当前管理员账号(含是否需改密);无效/过期 → SESSION_EXPIRED */
export function getAdminAccount(token: string | null | undefined): AdminAccount {
  const row = db_requireSessionRow(token);
  return { username: row.username, mustChangePassword: row.must_change_password === 1 };
}

/**
 * 修改口令:必须携带有效会话;校验当前口令与新口令复杂度。
 * 成功后 must_change_password=0,并吊销该账号其余会话(当前会话保留)。
 */
export function changeAdminPassword(input: ChangeAdminPasswordInput): AdminAccount {
  const sess = db_requireSessionRow(input.token);
  // 校验当前口令(防会话被劫持后直接改密);同样做恒时比较路径
  const ok = verifyPassword(input.currentPassword ?? '', sess.password_hash);
  if (!ok) {
    throw new CoreError('INVALID_CREDENTIALS', 'current password is incorrect');
  }
  if (!isStrongPassword(input.newPassword ?? '', sess.username)) {
    throw new CoreError('WEAK_PASSWORD', 'password must be ≥10 chars with upper/lower/digit/special and not contain the username');
  }
  if (input.newPassword === input.currentPassword) {
    throw new CoreError('WEAK_PASSWORD', 'new password must differ from the current one');
  }
  const now = new Date().toISOString();
  const db = getDb();
  db.prepare('UPDATE admin_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(
    hashPassword(input.newPassword),
    now,
    sess.id
  );
  db.prepare('DELETE FROM admin_sessions WHERE user_id = ? AND token != ?').run(sess.id, input.token);
  return { username: sess.username, mustChangePassword: false };
}

/** 登出:删除会话;令牌不存在也算幂等成功 */
export function logoutAdmin(token: string | null | undefined): void {
  if (!token) return;
  getDb().prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
}

function db_requireSessionRow(token: string | null | undefined): AdminUserRow & { id: string } {
  if (!token) {
    throw new CoreError('SESSION_EXPIRED', 'no session token');
  }
  ensureDefaultAdmin();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.* FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, new Date().toISOString()) as (AdminUserRow & { id: string }) | undefined;
  if (!row) {
    db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(new Date().toISOString());
    throw new CoreError('SESSION_EXPIRED', 'session invalid or expired');
  }
  return row;
}

function createAdminSession(adminId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();
  getDb()
    .prepare('INSERT INTO admin_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, adminId, expiresAt, new Date().toISOString());
  return { token, expiresAt };
}
