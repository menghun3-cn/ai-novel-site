// V5 AI 自动连载:每书连载配置 + 生成任务队列 + 每日流水线执行器
// 流水线:到点(日守卫幂等)→按 count 入队→逐任务 生成→质检→送审或(autoPublish)批准发布
// LLM 取源统一走 resolveProviderFromStore(后台设置 > 环境变量)

import { getDb } from './db';
import {
  CoreError,
  type AiSerializationConfig,
  type ConfigureAiSerializationPatch,
  type GenerationJob,
  type GenerationJobStatus,
} from './domain';
import { approveChapter, localDateKey } from './service';
import { generateChapterDraft, type GenerateChapterResult } from './ai-writer';
import { resolveProviderFromStore } from './settings';

function nowIso(): string {
  return new Date().toISOString();
}

function assertBook(bookId: string): void {
  if (!getDb().prepare('SELECT id FROM books WHERE id = ?').get(bookId)) {
    throw new CoreError('BOOK_NOT_FOUND', `book not found: ${bookId}`);
  }
}

// ---------- 连载配置 ----------

interface SerialRow {
  book_id: string;
  enabled: number;
  hour: number;
  count: number;
  auto_publish: number;
  min_chars: number;
  last_run_date: string | null;
}

function toConfig(r: SerialRow): AiSerializationConfig {
  return {
    bookId: r.book_id,
    enabled: r.enabled === 1,
    hour: r.hour,
    count: r.count,
    autoPublish: r.auto_publish === 1,
    minChars: r.min_chars,
    lastRunDate: r.last_run_date,
  };
}

/** 未创建时返回虚拟默认值(停用/8点/1章/送审模式/500字);书不存在抛 BOOK_NOT_FOUND */
export function getAiSerialization(bookId: string): AiSerializationConfig {
  assertBook(bookId);
  const row = getDb().prepare('SELECT * FROM ai_serialization WHERE book_id = ?').get(bookId) as SerialRow | undefined;
  if (!row) {
    return { bookId, enabled: false, hour: 8, count: 1, autoPublish: false, minChars: 500, lastRunDate: null };
  }
  return toConfig(row);
}

export function configureAiSerialization(bookId: string, patch: ConfigureAiSerializationPatch): AiSerializationConfig {
  assertBook(bookId);
  const current = getAiSerialization(bookId);
  const next = {
    enabled: patch.enabled ?? current.enabled,
    hour: patch.hour ?? current.hour,
    count: patch.count ?? current.count,
    autoPublish: patch.autoPublish ?? current.autoPublish,
    minChars: patch.minChars ?? current.minChars,
  };
  if (!Number.isInteger(next.hour) || next.hour < 0 || next.hour > 23) {
    throw new CoreError('INVALID_AI_SERIALIZATION', `hour must be 0-23: ${String(next.hour)}`);
  }
  if (!Number.isInteger(next.count) || next.count < 1 || next.count > 20) {
    throw new CoreError('INVALID_AI_SERIALIZATION', `count must be 1-20: ${String(next.count)}`);
  }
  if (!Number.isInteger(next.minChars) || next.minChars < 200 || next.minChars > 20000) {
    throw new CoreError('INVALID_AI_SERIALIZATION', `minChars must be 200-20000: ${String(next.minChars)}`);
  }
  const at = nowIso();
  getDb()
    .prepare(
      `INSERT INTO ai_serialization (book_id, enabled, hour, count, auto_publish, min_chars, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (book_id) DO UPDATE SET
         enabled = excluded.enabled, hour = excluded.hour, count = excluded.count,
         auto_publish = excluded.auto_publish, min_chars = excluded.min_chars, updated_at = excluded.updated_at`
    )
    .run(
      bookId,
      next.enabled ? 1 : 0,
      next.hour,
      next.count,
      next.autoPublish ? 1 : 0,
      next.minChars,
      at,
      at
    );
  return getAiSerialization(bookId);
}

// ---------- 任务队列 ----------

interface JobRow {
  id: number;
  book_id: string;
  chapter_number: number | null;
  status: string;
  attempt: number;
  error: string | null;
  chars: number | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

function toJob(r: JobRow): GenerationJob {
  return {
    id: r.id,
    bookId: r.book_id,
    chapterNumber: r.chapter_number,
    status: r.status as GenerationJobStatus,
    attempt: r.attempt,
    error: r.error,
    chars: r.chars,
    model: r.model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listGenerationJobs(bookId?: string, limit = 50): GenerationJob[] {
  const n = Math.max(1, Math.min(limit, 200));
  const rows = (
    bookId
      ? getDb()
          .prepare('SELECT * FROM generation_jobs WHERE book_id = ? ORDER BY id DESC LIMIT ?')
          .all(bookId, n)
      : getDb().prepare('SELECT * FROM generation_jobs ORDER BY id DESC LIMIT ?').all(n)
  ) as JobRow[];
  return rows.map(toJob);
}

/** 批量入队(如「AI 生成前 N 章」);书不存在抛错 */
export function enqueueGenerationJobs(bookId: string, count: number): GenerationJob[] {
  assertBook(bookId);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new CoreError('INVALID_AI_SERIALIZATION', `enqueue count must be 1-50: ${String(count)}`);
  }
  const db = getDb();
  const at = nowIso();
  const stmt = db.prepare(
    "INSERT INTO generation_jobs (book_id, chapter_number, status, attempt, created_at, updated_at) VALUES (?, NULL, 'pending', 0, ?, ?)"
  );
  const jobs: GenerationJob[] = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const res = stmt.run(bookId, at, at);
      jobs.push(toJob(db.prepare('SELECT * FROM generation_jobs WHERE id = ?').get(Number(res.lastInsertRowid)) as JobRow));
    }
  });
  tx();
  return jobs;
}

// ---------- 执行 ----------

async function executeJob(job: GenerationJob): Promise<GenerationJob> {
  const db = getDb();
  const config = getAiSerialization(job.bookId);
  const touch = (fields: Partial<Pick<GenerationJob, 'status' | 'attempt' | 'error' | 'chapterNumber' | 'chars' | 'model'>>): void => {
    db.prepare(
      `UPDATE generation_jobs SET status = COALESCE(?, status), attempt = COALESCE(?, attempt), error = ?,
         chapter_number = COALESCE(?, chapter_number), chars = COALESCE(?, chars), model = COALESCE(?, model), updated_at = ?
       WHERE id = ?`
    ).run(fields.status ?? null, fields.attempt ?? null, fields.error ?? null, fields.chapterNumber ?? null, fields.chars ?? null, fields.model ?? null, nowIso(), job.id);
  };

  try {
    touch({ status: 'running', attempt: job.attempt + 1 });
    const provider = await resolveProviderFromStore();
    const result: GenerateChapterResult = await generateChapterDraft(job.bookId, {
      provider,
      submitForReview: true,
      llmReview: false,
      minChars: config.minChars,
    });
    if (!result.created) {
      const detail = result.quality.issues.map((i) => `${i.code}:${i.detail}`).join('; ');
      touch({ status: 'rejected', error: detail });
      return getJob(job.bookId, job.id)!;
    }
    let finalStatus: GenerationJobStatus = 'submitted';
    if (config.autoPublish) {
      approveChapter(job.bookId, result.chapterNumber, { mode: 'now' });
      finalStatus = 'published';
    }
    touch({
      status: finalStatus,
      chapterNumber: result.chapterNumber,
      chars: result.chars,
      model: provider.name.replace('openai-compatible:', ''),
      error: null,
    });
    return getJob(job.bookId, job.id)!;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    touch({ status: 'failed', error: `${e.code ?? 'ERROR'}: ${String(e.message).slice(0, 300)}` });
    return getJob(job.bookId, job.id)!;
  }
}

export function getJob(bookId: string, id: number): GenerationJob | null {
  const row = getDb().prepare('SELECT * FROM generation_jobs WHERE book_id = ? AND id = ?').get(bookId, id) as
    | JobRow
    | undefined;
  return row ? toJob(row) : null;
}

/** 处理队列:按最旧 pending 依次执行至多 limit 个 */
export async function processGenerationJobs(limit = 10): Promise<{ processed: number }> {
  const rows = getDb()
    .prepare("SELECT * FROM generation_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT ?")
    .all(Math.max(1, Math.min(limit, 100))) as JobRow[];
  for (const row of rows) {
    await executeJob(toJob(row));
  }
  return { processed: rows.length };
}

export interface SerializationCycleResult {
  /** 触发了入队的书籍数 */
  booksTriggered: number;
  /** 本次新入队任务数 */
  enqueued: number;
  /** 实际处理任务数 */
  processed: number;
}

/**
 * 每日 AI 连载周期:对每本启用且今日未跑、到达时刻的书:
 * 入队 count 个生成任务 → 记 last_run_date → 处理队列。日守卫幂等。
 */
export async function runAiSerializationCycle(now = new Date()): Promise<SerializationCycleResult> {
  const today = localDateKey(now);
  const rows = getDb()
    .prepare('SELECT * FROM ai_serialization WHERE enabled = 1 AND (last_run_date IS NULL OR last_run_date < ?)')
    .all(today) as SerialRow[];
  let enqueued = 0;
  let triggered = 0;
  for (const row of rows) {
    const cfg = toConfig(row);
    if (now.getHours() < cfg.hour) continue;
    enqueueGenerationJobs(cfg.bookId, cfg.count);
    getDb().prepare('UPDATE ai_serialization SET last_run_date = ?, updated_at = ? WHERE book_id = ?').run(today, nowIso(), cfg.bookId);
    triggered++;
    enqueued += cfg.count;
  }
  const { processed } = await processGenerationJobs(100);
  return { booksTriggered: triggered, enqueued, processed };
}
