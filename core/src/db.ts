// SQLite 连接与建表(幂等 DDL),数据文件默认放在仓库根 data/novel.db
// 生产构建中 import.meta.url 会被 webpack 打包,改用 process.cwd() 解析

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

/** 业务表短前缀随机 ID(如 ss_ / ssv_ / rrule_),与 book_<slug> 的确定性主键区分 */
export function genId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

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

/** 解析后的数据目录(scheduler lock 等进程级文件与数据库同目录) */
export function getDataDir(): string {
  return dataDir;
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
  updated_at TEXT NOT NULL,
  -- V9 阶段二:长篇自动评审配置
  chapter_review_enabled INTEGER NOT NULL DEFAULT 1,         -- 单章评审默认开
  chapter_review_max_rounds INTEGER NOT NULL DEFAULT 1,      -- 章节自动优化轮数(成本控制)
  arc_review_every_n INTEGER NOT NULL DEFAULT 5,             -- 每新增 N 章自动弧评;0=禁用
  last_arc_review_chapter INTEGER NOT NULL DEFAULT 0,        -- 上次弧评覆盖到的最大章号(用于半自动判定)
  arc_review_enabled INTEGER NOT NULL DEFAULT 1,              -- 是否允许弧评(总开关)
  kind TEXT NOT NULL DEFAULT 'long'                          -- 'long'=长篇连载;'short'=短篇物化
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
  optimize_round INTEGER NOT NULL DEFAULT 0,  -- V9.5:章节自动优化轮数(由 chapter_review_max_rounds 约束)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (book_id, number)
);

CREATE INDEX IF NOT EXISTS idx_chapters_published_at ON chapters(published_at);
CREATE INDEX IF NOT EXISTS idx_chapters_status_scheduled ON chapters(status, scheduled_at);

-- V4 Story Core:世界观/人物/关系/故事线/章节大纲/伏笔(每书隔离)
CREATE TABLE IF NOT EXISTS story_worlds (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL UNIQUE REFERENCES books(id),
  setting TEXT NOT NULL DEFAULT '',
  rules TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'supporting',
  persona TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (book_id, name)
);

CREATE TABLE IF NOT EXISTS story_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id),
  from_name TEXT NOT NULL,
  to_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story_arcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  start_chapter INTEGER,
  end_chapter INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS story_outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  beats TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (book_id, number)
);

CREATE TABLE IF NOT EXISTS story_foreshadowing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id),
  label TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  planted_chapter INTEGER,
  resolved_chapter INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_story_characters_book ON story_characters(book_id);
CREATE INDEX IF NOT EXISTS idx_story_relationships_book ON story_relationships(book_id);
CREATE INDEX IF NOT EXISTS idx_story_arcs_book ON story_arcs(book_id);
CREATE INDEX IF NOT EXISTS idx_story_outlines_book ON story_outlines(book_id, number);
CREATE INDEX IF NOT EXISTS idx_story_foreshadowing_book ON story_foreshadowing(book_id);

-- 运行时配置(键值):LLM 服务等运营者可在后台调整的配置
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

-- V5 AI 自动连载:每书配置 + 生成任务历史
CREATE TABLE IF NOT EXISTS ai_serialization (
  book_id TEXT PRIMARY KEY REFERENCES books(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  hour INTEGER NOT NULL DEFAULT 8,
  count INTEGER NOT NULL DEFAULT 1,
  auto_publish INTEGER NOT NULL DEFAULT 0,
  min_chars INTEGER NOT NULL DEFAULT 500,
  last_run_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id),
  chapter_number INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  chars INTEGER,
  model TEXT,
  instructions TEXT,
  min_chars INTEGER,
  submit_for_review INTEGER,
  llm_review INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_book ON generation_jobs(book_id, status);

-- V6 Reader Platform:读者账号与会话
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- V6 个性化:收藏 / 订阅 / 阅读进度
CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  last_seen_chapter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  percent INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_user_time ON reading_progress(user_id, updated_at DESC);

-- V8 数据分析:阅读会话(记录每次打开章页到离开/完读的时长)
CREATE TABLE IF NOT EXISTS reading_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_sec INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reading_sessions_book_chapter ON reading_sessions(book_id, chapter_number);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_started ON reading_sessions(started_at);

-- V8.1 Admin 账号:库初始化即由 admin-auth 播种默认账号(admin/Admin@123456),
-- must_change_password=1 时登录后强制改为复杂密码
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);

-- V9 AI小说创作与自动评审中心:短篇小说版本化 + 评审规则/Prompt版本化 + 评审记录 + 统一AI任务
-- 版本表只增不改:AI 写入一律新行,历史数据永不因规则升级被覆盖(规格书 §43)
CREATE TABLE IF NOT EXISTS short_stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  brief_json TEXT NOT NULL DEFAULT '{}',
  current_version_id TEXT,
  source_url TEXT,
  scheduled_at TEXT,  -- V9.5 阶段二补丁:定时创作,status='scheduled' 时有效
  review_round INTEGER NOT NULL DEFAULT 0,
  optimize_round INTEGER NOT NULL DEFAULT 0,
  manual_optimize_round INTEGER NOT NULL DEFAULT 0,
  last_score INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS short_story_versions (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES short_stories(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  creation_reason TEXT NOT NULL DEFAULT 'generated',
  generation_prompt TEXT,
  model_name TEXT,
  is_final INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (story_id, version)
);

CREATE INDEX IF NOT EXISTS idx_short_stories_status ON short_stories(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_short_story_versions_story ON short_story_versions(story_id, version);

CREATE TABLE IF NOT EXISTS review_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_rule_versions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES review_rules(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  quality_threshold INTEGER NOT NULL DEFAULT 80,
  max_auto_optimize_rounds INTEGER NOT NULL DEFAULT 3,
  prompt_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (rule_id, version)
);

CREATE INDEX IF NOT EXISTS idx_review_rule_versions_rule ON review_rule_versions(rule_id, status);

CREATE TABLE IF NOT EXISTS review_prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  content TEXT NOT NULL,
  rule_version_id TEXT,
  model_hint TEXT,
  change_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS review_records (
  id TEXT PRIMARY KEY,
  story_id TEXT,                                  -- V9 阶段二:章节/弧级评审时为 NULL
  story_version_id TEXT,                          -- V9 阶段二:章节/弧级评审时为 NULL
  source_url TEXT,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  prompt_id TEXT,
  prompt_version TEXT,
  model_id TEXT,
  model_name TEXT,
  model_version TEXT,
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  qualified INTEGER NOT NULL,
  dimension_scores_json TEXT NOT NULL,
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  review_round INTEGER NOT NULL,
  optimization_round INTEGER NOT NULL,
  duration_ms INTEGER,
  raw_response TEXT,
  structured_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_records_story ON review_records(story_id, story_version_id, created_at);
CREATE INDEX IF NOT EXISTS idx_review_records_rule ON review_records(rule_id, rule_version);

-- 统一 AI 任务(规格书 §35):字段辅助/整篇生成/评审/优化的可观测任务历史
CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  ref_type TEXT,
  ref_id TEXT,
  input_json TEXT,
  prompt TEXT,
  provider_name TEXT,
  model_name TEXT,
  output_json TEXT,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_pick ON ai_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_ref ON ai_tasks(ref_type, ref_id, created_at);

-- V9 阶段二:短篇发布追溯(passed 短篇物化为 Book+Chapter 的可追溯记录)
CREATE TABLE IF NOT EXISTS short_story_publications (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL REFERENCES short_stories(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  UNIQUE(story_id, version_id)
);
CREATE INDEX IF NOT EXISTS idx_short_story_publications_story ON short_story_publications(story_id);

-- V9.6 批量定时创作:到点一次性创建 count 篇短篇并逐篇入队创作流水线(标题自动生成,通过评审后自动发布)
CREATE TABLE IF NOT EXISTS short_story_batch_schedules (
  id TEXT PRIMARY KEY,
  scheduled_at TEXT NOT NULL,          -- 触发时间(UTC ISO 串,精度到分钟)
  count INTEGER NOT NULL DEFAULT 1,    -- 到点生成的短篇数量
  brief_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|executing|done|failed|cancelled
  story_ids_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  repeat_daily INTEGER NOT NULL DEFAULT 0, -- V9.7:1=每天同一时刻重复触发;0=一次性
  last_fired_date TEXT,                -- V9.7:每日计划上次触发日期(服务器本地 YYYY-MM-DD,同日去重)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  executed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_short_story_batch_schedules_due ON short_story_batch_schedules(status, scheduled_at);

-- V9 阶段二:长篇弧级评审记录(独立表:弧级评审的实体边界与短篇/章节不同)
CREATE TABLE IF NOT EXISTS arc_review_records (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  arc_id TEXT,
  arc_label TEXT NOT NULL,
  from_chapter INTEGER NOT NULL,
  to_chapter INTEGER NOT NULL,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  prompt_id TEXT,
  prompt_version TEXT,
  model_name TEXT,
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  qualified INTEGER NOT NULL,
  dimension_scores_json TEXT NOT NULL,
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  duration_ms INTEGER,
  raw_response TEXT,
  structured_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arc_review_records_book ON arc_review_records(book_id, created_at);

-- V10 内容工厂:产线(Production Line)与批次运行 —— 批量生成不同题材/类型短篇的一等实体
CREATE TABLE IF NOT EXISTS production_lines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  last_run_at TEXT,
  last_run_date TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  max_consecutive_failures INTEGER NOT NULL DEFAULT 3,
  tripped_reason TEXT,
  tripped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production_runs (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES production_lines(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,              -- 'manual' | 'daily' | 'continuous'
  run_date TEXT NOT NULL,             -- 服务器本地 'YYYY-MM-DD'
  count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|executing|done|failed|cancelled
  items_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  executed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_production_runs_line ON production_runs(line_id, run_date, created_at);
CREATE INDEX IF NOT EXISTS idx_production_runs_due ON production_runs(status, run_date);

-- V10 内容工厂:运行-作品 关联表(可聚合查询:某产线产出的所有短篇)
CREATE TABLE IF NOT EXISTS production_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  story_id TEXT REFERENCES short_stories(id) ON DELETE SET NULL,
  genre TEXT NOT NULL,
  seed_index INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_production_run_items_run ON production_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_production_run_items_story ON production_run_items(story_id);
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

/**
 * 轻量迁移:V5.0.1——generation_jobs 补每任务生成选项列
 * (instructions/min_chars/submit_for_review/llm_review,NULL=沿用书的连载配置)。
 */
function migrateJobOptionColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(generation_jobs)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('instructions')) db.exec('ALTER TABLE generation_jobs ADD COLUMN instructions TEXT');
  if (!cols.includes('min_chars')) db.exec('ALTER TABLE generation_jobs ADD COLUMN min_chars INTEGER');
  if (!cols.includes('submit_for_review')) db.exec('ALTER TABLE generation_jobs ADD COLUMN submit_for_review INTEGER');
  if (!cols.includes('llm_review')) db.exec('ALTER TABLE generation_jobs ADD COLUMN llm_review INTEGER');
}

/**
 * 轻量迁移:V7 Discovery 热度信号列(books.view_count, chapters.view_count/finish_count)。
 */
function migrateDiscoveryColumns(db: Database.Database): void {
  const bookCols = (db.prepare('PRAGMA table_info(books)').all() as { name: string }[]).map((c) => c.name);
  if (!bookCols.includes('view_count')) db.exec('ALTER TABLE books ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
  const chapterCols = (db.prepare('PRAGMA table_info(chapters)').all() as { name: string }[]).map((c) => c.name);
  if (!chapterCols.includes('view_count')) db.exec('ALTER TABLE chapters ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
  if (!chapterCols.includes('finish_count')) db.exec('ALTER TABLE chapters ADD COLUMN finish_count INTEGER NOT NULL DEFAULT 0');
}

/**
 * 轻量迁移:V8 Analytics——reading_sessions 表(DDL 已建,此函数仅为完整性占位;
 * 旧库会由 DDL 的 CREATE TABLE IF NOT EXISTS 自动补齐)。
 */
function migrateAnalyticsColumns(_db: Database.Database): void {
  // reading_sessions 在新旧库均由 DDL 中的 IF NOT EXISTS 保证存在;
  // 此处保留为后续可能添加的新列预留迁移点。
}

/**
 * 轻量迁移:V9——short_stories 补手动优化独立计数列
 * (自动流水线受 max_auto_optimize_rounds 约束,手动优化单独计数)。
 */
function migrateShortStoryColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(short_stories)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('manual_optimize_round')) {
    db.exec('ALTER TABLE short_stories ADD COLUMN manual_optimize_round INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('scheduled_at')) {
    db.exec('ALTER TABLE short_stories ADD COLUMN scheduled_at TEXT');
  }
}

/**
 * 轻量迁移:V9.5 阶段二补丁 — chapters 表补自动优化轮数列(用于 chapter_review_max_rounds 阈值判定)
 */
function migrateChapterColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(chapters)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('optimize_round')) {
    db.exec('ALTER TABLE chapters ADD COLUMN optimize_round INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * 轻量迁移:V9 阶段二 — books 表补长篇自动评审配置列(旧库升级)
 */
function migrateBooksReviewColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(books)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('chapter_review_enabled')) {
    db.exec('ALTER TABLE books ADD COLUMN chapter_review_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!cols.includes('chapter_review_max_rounds')) {
    db.exec('ALTER TABLE books ADD COLUMN chapter_review_max_rounds INTEGER NOT NULL DEFAULT 1');
  }
  if (!cols.includes('arc_review_every_n')) {
    db.exec('ALTER TABLE books ADD COLUMN arc_review_every_n INTEGER NOT NULL DEFAULT 5');
  }
  if (!cols.includes('last_arc_review_chapter')) {
    db.exec('ALTER TABLE books ADD COLUMN last_arc_review_chapter INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('arc_review_enabled')) {
    db.exec('ALTER TABLE books ADD COLUMN arc_review_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!cols.includes('kind')) {
    db.exec("ALTER TABLE books ADD COLUMN kind TEXT NOT NULL DEFAULT 'long'");
  }
}

/**
 * 轻量迁移:V9 阶段二 — review_records 扩可空列,以统一短篇/章节/弧的评审记录入口
 */
function migrateReviewRecordsRefColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(review_records)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('chapter_id')) {
    db.exec('ALTER TABLE review_records ADD COLUMN chapter_id TEXT');
  }
  if (!cols.includes('ref_type')) {
    db.exec("ALTER TABLE review_records ADD COLUMN ref_type TEXT NOT NULL DEFAULT 'short_story'");
  }
}

/**
 * 轻量迁移:V9.7——short_story_batch_schedules 补每日重复触发列(旧库升级)
 */
function migrateBatchScheduleColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(short_story_batch_schedules)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('repeat_daily')) {
    db.exec('ALTER TABLE short_story_batch_schedules ADD COLUMN repeat_daily INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('last_fired_date')) {
    db.exec('ALTER TABLE short_story_batch_schedules ADD COLUMN last_fired_date TEXT');
  }
}

/**
 * 轻量迁移:V10.5 持续创作——production_lines 补熔断列(旧库升级;新库由 DDL 直接建出)
 */
function migrateProductionLineColumns(db: Database.Database): void {
  const cols = (db.prepare('PRAGMA table_info(production_lines)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('consecutive_failures')) {
    db.exec('ALTER TABLE production_lines ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('max_consecutive_failures')) {
    db.exec('ALTER TABLE production_lines ADD COLUMN max_consecutive_failures INTEGER NOT NULL DEFAULT 3');
  }
  if (!cols.includes('tripped_reason')) {
    db.exec('ALTER TABLE production_lines ADD COLUMN tripped_reason TEXT');
  }
  if (!cols.includes('tripped_at')) {
    db.exec('ALTER TABLE production_lines ADD COLUMN tripped_at TEXT');
  }
}

// ---------- 基础分类种子 ----------

/**
 * 市面上已知的主流分类(长篇小说题材为主,兼收短篇常见题材)。
 * 保持分类表扁平:kind 由书籍自身(kind 列)决定,分类只表示题材。
 * 幂等:INSERT OR IGNORE 按 name 唯一键插入,重复运行不产生脏数据。
 */
const DEFAULT_CATEGORIES = [
  // 主流网文题材(长篇小说)
  '科幻', '玄幻', '都市', '穿越', '历史', '悬疑', '奇幻', '仙侠', '武侠', '军事', '网游', '体育',
  '言情', '都市言情', '古代言情', '宫斗', '权谋', '末世', '系统', '游戏', '二次元', '轻小说', '现实',
  '推理', '冒险', '灵异', '惊悚', '校园', '职场', '美食', '直播', '神医', '学霸', '娱乐', '明星',
  '萌宝', '宠物', '星际', '末日', '克苏鲁', '洪荒', '种田', '基建', '赛博朋克', '无敌流', '快穿',
  '无限流', '重生', '洪荒流', '签到流', '领主流', '召唤流', '国术', '竞技', '谍战', '抗战', '商战',
  // 短篇常见题材
  '爱情', '幽默', '寓言', '恐怖', '治愈', '脑洞', '反转', '青春', '家庭', '亲情', '友情', '励志',
  '暖心', '虐心', '古风', '伦理', '社会', '轻悬疑', '甜宠',
].filter((v, i, arr) => arr.indexOf(v) === i);

/** 幂等播种基础分类(仅插入缺失项,不触碰已有分类) */
function seedDefaultCategories(db: Database.Database): void {
  const insert = db.prepare('INSERT OR IGNORE INTO categories (slug, name) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const name of DEFAULT_CATEGORIES) {
      const slug = name.trim().replace(/\s+/g, '-').toLowerCase();
      insert.run(slug, name);
    }
  });
  tx();
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
    migrateJobOptionColumns(sqlite);
    migrateDiscoveryColumns(sqlite);
    migrateAnalyticsColumns(sqlite);
    migrateShortStoryColumns(sqlite);
    migrateChapterColumns(sqlite);
    migrateBooksReviewColumns(sqlite);
    migrateReviewRecordsRefColumns(sqlite);
    migrateBatchScheduleColumns(sqlite);
    migrateProductionLineColumns(sqlite);
    seedDefaultCategories(sqlite);
  }
  return sqlite;
}
