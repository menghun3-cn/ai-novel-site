// SQLite 连接与建表(幂等 DDL),数据文件默认放在仓库根 data/novel.db
// 生产构建中 import.meta.url 会被 webpack 打包,改用 process.cwd() 解析

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// 兼容:开发模式 import.meta.url 指向 core/src,生产模式指向 .next/server/
// 优先使用环境变量;其次从 cwd 向上查找 data/ 目录
function resolveDataDir(): string {
  if (process.env.NOVEL_DATA_DIR) {
    return path.resolve(process.env.NOVEL_DATA_DIR);
  }
  // 从当前工作目录向上查找包含 data/ 的仓库根
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'data', '.gitkeep')) || fs.existsSync(path.join(dir, 'data', 'novel.db'))) {
      return path.join(dir, 'data');
    }
    dir = path.dirname(dir);
  }
  // 回退:cwd/data
  return path.join(process.cwd(), 'data');
}

const dataDir = resolveDataDir();
const dbPath = path.join(dataDir, 'novel.db');

export function getDbPath(): string {
  return dbPath;
}

export function ensureDataDir(): void {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DDL = `
CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  bio TEXT,
  avatar_path TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  cover_path TEXT,
  status TEXT NOT NULL DEFAULT 'serializing',
  author_id INTEGER NOT NULL REFERENCES authors(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  autopilot_enabled INTEGER NOT NULL DEFAULT 0,
  autopilot_hour INTEGER NOT NULL DEFAULT 8,
  autopilot_count INTEGER NOT NULL DEFAULT 1,
  autopilot_last_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_tags (
  book_id TEXT NOT NULL REFERENCES books(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (book_id, tag_id)
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT,
  content_md TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (book_id, number)
);

CREATE INDEX IF NOT EXISTS idx_chapters_published_at ON chapters(published_at);
CREATE INDEX IF NOT EXISTS idx_chapters_status_scheduled ON chapters(status, scheduled_at);
`;

let sqlite: Database.Database | null = null;

/**
 * 轻量迁移:已有库的 authors 表补齐 V2 管理列(bio/avatar_path)。
 * 新库由 DDL 直接建出;老库按 PRAGMA 检查后 ALTER,幂等。
 */
function migrateAuthorColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(authors)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('bio')) db.exec('ALTER TABLE authors ADD COLUMN bio TEXT');
  if (!cols.includes('avatar_path')) db.exec('ALTER TABLE authors ADD COLUMN avatar_path TEXT');
}

/**
 * 轻量迁移:V3 发布核心——books 补自动发布配置列,chapters 补驳回备注列。
 * 幂等;老数据默认关闭自动发布(hour=8,count=1 与文档示例一致)。
 */
function migratePublishColumns(db: Database.Database): void {
  const bookCols = (db.prepare('PRAGMA table_info(books)').all() as { name: string }[]).map((c) => c.name);
  if (!bookCols.includes('autopilot_enabled')) db.exec('ALTER TABLE books ADD COLUMN autopilot_enabled INTEGER NOT NULL DEFAULT 0');
  if (!bookCols.includes('autopilot_hour')) db.exec('ALTER TABLE books ADD COLUMN autopilot_hour INTEGER NOT NULL DEFAULT 8');
  if (!bookCols.includes('autopilot_count')) db.exec('ALTER TABLE books ADD COLUMN autopilot_count INTEGER NOT NULL DEFAULT 1');
  if (!bookCols.includes('autopilot_last_date')) db.exec('ALTER TABLE books ADD COLUMN autopilot_last_date TEXT');
  const chapterCols = (db.prepare('PRAGMA table_info(chapters)').all() as { name: string }[]).map((c) => c.name);
  if (!chapterCols.includes('review_note')) db.exec('ALTER TABLE chapters ADD COLUMN review_note TEXT');
}

export function getDb(): Database.Database {
  if (!sqlite) {
    ensureDataDir();
    sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(DDL);
    migrateAuthorColumns(sqlite);
    migratePublishColumns(sqlite);
  }
  return sqlite;
}
