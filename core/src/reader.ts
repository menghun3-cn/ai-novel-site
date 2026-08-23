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

// ---------- V6 个性化:收藏 / 订阅 / 阅读进度 ----------

function assertBookExists(bookId: string): void {
  if (!getDb().prepare('SELECT id FROM books WHERE id = ?').get(bookId)) {
    throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);
  }
}

/** 收藏/取消收藏(幂等);返回切换后的状态 */
export function toggleFavorite(userId: string, bookId: string): boolean {
  const db = getDb();
  assertBookExists(bookId);
  const has = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND book_id = ?').get(userId, bookId);
  if (has) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND book_id = ?').run(userId, bookId);
    return false;
  }
  db.prepare('INSERT INTO favorites (user_id, book_id, created_at) VALUES (?, ?, ?)').run(userId, bookId, new Date().toISOString());
  return true;
}

export function isFavorited(userId: string, bookId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM favorites WHERE user_id = ? AND book_id = ?').get(userId, bookId));
}

export function isSubscribed(userId: string, bookId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM subscriptions WHERE user_id = ? AND book_id = ?').get(userId, bookId));
}

/** 订阅/退订(幂等) */
export function toggleSubscription(userId: string, bookId: string): boolean {
  const db = getDb();
  assertBookExists(bookId);
  const has = db.prepare('SELECT 1 FROM subscriptions WHERE user_id = ? AND book_id = ?').get(userId, bookId);
  if (has) {
    db.prepare('DELETE FROM subscriptions WHERE user_id = ? AND book_id = ?').run(userId, bookId);
    return false;
  }
  db.prepare('INSERT INTO subscriptions (user_id, book_id, last_seen_chapter, created_at) VALUES (?, ?, 0, ?)').run(
    userId,
    bookId,
    new Date().toISOString()
  );
  return true;
}

/**
 * 上报阅读进度(upsert;章号必须为该书已发布章节,否则 CHAPTER_NOT_FOUND)。
 * 同时把订阅的 last_seen_chapter 前移到该章(只增不减),驱动「有更新」判定。
 */
export function reportProgress(userId: string, bookId: string, chapterNumber: number, percent = 0): void {
  if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
    throw new CoreError('INVALID_INPUT', `chapterNumber must be a positive integer: ${String(chapterNumber)}`);
  }
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const db = getDb();
  const ch = db.prepare("SELECT number FROM chapters WHERE book_id = ? AND number = ? AND status = 'published'").get(bookId, chapterNumber);
  if (!ch) {
    throw new CoreError('CHAPTER_NOT_FOUND', `published chapter not found: #${chapterNumber}`);
  }
  db.prepare(
    `INSERT INTO reading_progress (user_id, book_id, chapter_number, percent, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, book_id) DO UPDATE SET
       chapter_number = excluded.chapter_number, percent = excluded.percent, updated_at = excluded.updated_at`
  ).run(userId, bookId, chapterNumber, clamped, new Date().toISOString());
  // 订阅的已看章号只增不减(读到旧章不回退更新提示)
  db.prepare('UPDATE subscriptions SET last_seen_chapter = MAX(last_seen_chapter, ?) WHERE user_id = ? AND book_id = ?').run(
    chapterNumber,
    userId,
    bookId
  );
}

interface ShelfRow {
  id: string;
  slug: string;
  title: string;
  author_name: string;
  favorited: number;
  subscribed: number;
  published_count: number;
  progress_chapter: number | null;
  progress_percent: number;
}

/** 书架:收藏 ∪ 订阅 的书,合并发布章数/阅读进度/更新提示;按最近阅读排序 */
export function getReaderShelf(userId: string): ShelfEntryView[] {
  const rows = getDb()
    .prepare(
      `SELECT b.id, b.slug, b.title, a.name AS author_name,
         (f.user_id IS NOT NULL) AS favorited,
         (s.user_id IS NOT NULL) AS subscribed,
         (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id AND c.status = 'published') AS published_count,
         rp.chapter_number AS progress_chapter,
         COALESCE(rp.percent, 0) AS progress_percent
       FROM books b
       JOIN authors a ON a.id = b.author_id
       LEFT JOIN favorites f ON f.book_id = b.id AND f.user_id = ?
       LEFT JOIN subscriptions s ON s.book_id = b.id AND s.user_id = ?
       LEFT JOIN reading_progress rp ON rp.book_id = b.id AND rp.user_id = ?
       WHERE f.user_id IS NOT NULL OR s.user_id IS NOT NULL
       ORDER BY COALESCE(rp.updated_at, f.created_at, s.created_at) DESC`
    )
    .all(userId, userId, userId) as ShelfRow[];
  return rows.map((r) => ({
    bookId: r.id,
    slug: r.slug,
    title: r.title,
    authorName: r.author_name,
    publishedCount: r.published_count,
    latestChapter: r.published_count > 0 ? r.published_count : null,
    favorited: r.favorited === 1,
    subscribed: r.subscribed === 1,
    progressChapter: r.progress_chapter,
    progressPercent: r.progress_percent,
    hasUpdate: r.progress_chapter === null ? r.published_count > 0 : r.published_count > r.progress_chapter,
  }));
}

type ShelfEntryView = import('./domain').ShelfEntry;

interface HistoryRow {
  book_id: string;
  slug: string;
  title: string;
  chapter_number: number;
  percent: number;
  updated_at: string;
}

/** 最近阅读:按进度更新时间倒序 */
export function getReadingHistory(userId: string, limit = 20): import('./domain').HistoryEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT rp.book_id, b.slug, b.title, rp.chapter_number, rp.percent, rp.updated_at
       FROM reading_progress rp JOIN books b ON b.id = rp.book_id
       WHERE rp.user_id = ? ORDER BY rp.updated_at DESC LIMIT ?`
    )
    .all(userId, Math.max(1, Math.min(limit, 100))) as HistoryRow[];
  return rows.map((r) => ({
    bookId: r.book_id,
    slug: r.slug,
    title: r.title,
    chapterNumber: r.chapter_number,
    percent: r.percent,
    updatedAt: r.updated_at,
  }));
}
