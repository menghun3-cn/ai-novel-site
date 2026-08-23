// V6 Reader Platform:读者账号、会话与个性化(书架/收藏/订阅/阅读进度)
// 口令哈希用 node:crypto scrypt(salt 随机 16B,格式 `scrypt:N:salt:hash`),无外部依赖

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './db';
import { CoreError, type LoginReaderInput, type ReaderSession, type ReaderUser, type RegisterReaderInput } from './domain';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

const USERNAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_]{2,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
}

function toUser(r: UserRow): ReaderUser {
  return { id: r.id, username: r.username, email: r.email, createdAt: r.created_at };
}

/** 注册:用户名/邮箱唯一(大小写不敏感);口令 ≥8 位。成功即建立会话 */
export function registerReader(input: RegisterReaderInput): ReaderSession {
  const username = input.username?.trim() ?? '';
  const email = input.email?.trim().toLowerCase() ?? '';
  const password = input.password ?? '';
  if (!USERNAME_RE.test(username)) {
    throw new CoreError('INVALID_INPUT', 'username must be 2-24 chars (中文/字母/数字/下划线)');
  }
  if (!EMAIL_RE.test(email)) {
    throw new CoreError('INVALID_INPUT', 'email format is invalid');
  }
  if (password.length < 8) {
    throw new CoreError('INVALID_INPUT', 'password must be at least 8 characters');
  }
  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
    throw new CoreError('USERNAME_TAKEN', `username already taken: ${username}`);
  }
  if (db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email)) {
    throw new CoreError('EMAIL_TAKEN', `email already registered: ${email}`);
  }
  const user: UserRow = {
    id: `user_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    username,
    email,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    user.id,
    user.username,
    user.email,
    user.password_hash,
    user.created_at
  );
  return createSession(user.id);
}

/** 登录:login 可为用户名或邮箱 */
export function loginReader(input: LoginReaderInput): ReaderSession {
  const login = input.login?.trim() ?? '';
  const row = db_findUserByLogin(login);
  // 用户不存在时也做一次哈希计算,避免时序侧信道暴露账号存在性
  const stored = row?.password_hash ?? `scrypt:${randomBytes(16).toString('hex')}:${'0'.repeat(128)}`;
  const ok = verifyPassword(input.password ?? '', stored);
  if (!row || !ok) {
    throw new CoreError('INVALID_CREDENTIALS', 'invalid login or password');
  }
  return createSession(row.id);
}

function db_findUserByLogin(login: string): UserRow | undefined {
  return getDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
    .get(login, login) as UserRow | undefined;
}

function createSession(userId: string): ReaderSession {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, expiresAt, new Date().toISOString());
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
  return { token, expiresAt, user: toUser(user) };
}

/** 按会话令牌取当前读者;无效/过期 → SESSION_EXPIRED,并顺手清理过期行 */
export function getSessionReader(token: string | null | undefined): ReaderUser {
  if (!token) {
    throw new CoreError('SESSION_EXPIRED', 'no session token');
  }
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, new Date().toISOString()) as UserRow | undefined;
  if (!row) {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    throw new CoreError('SESSION_EXPIRED', 'session invalid or expired');
  }
  return toUser(row);
}

/** 登出:删除会话;令牌不存在也算幂等成功 */
export function logoutReader(token: string | null | undefined): void {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
