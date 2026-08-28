// V9.6 批量定时创作:一个计划 = 到点一次性创建 count 篇短篇并逐篇入队创作流水线。
// 与单篇定时(short-stories.scheduled_at)互补:单篇定时管"这一篇到点开始写",
// 批量定时管"到点按同一份创作需求批量生成 N 篇";标题不填时由流水线自动生成,
// 每篇独立走 生成 → 评审 → (达标)自动发布 闭环。
// 创建故事与入队均为本地 DB 操作(无 LLM 调用),到点执行瞬时完成,失败可重试。

import { getDb, genId } from './db';
import { CoreError, type ShortStoryBatchSchedule, type ShortStoryBatchScheduleStatus } from './domain';
import { createShortStory } from './short-story';
import { enqueueCreationPipeline } from './short-story-pipeline';
import { normalizeBrief } from './short-story';

const BATCH_STATUSES: readonly ShortStoryBatchScheduleStatus[] = [
  'pending',
  'executing',
  'done',
  'failed',
  'cancelled',
];

function isBatchStatus(v: unknown): v is ShortStoryBatchScheduleStatus {
  return typeof v === 'string' && (BATCH_STATUSES as readonly string[]).includes(v);
}

interface ScheduleRow {
  id: string;
  scheduled_at: string;
  count: number;
  brief_json: string;
  status: string;
  story_ids_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
}

function toSchedule(row: ScheduleRow): ShortStoryBatchSchedule {
  return {
    id: row.id,
    scheduledAt: row.scheduled_at,
    count: row.count,
    brief: JSON.parse(row.brief_json) as ShortStoryBatchSchedule['brief'],
    status: (isBatchStatus(row.status) ? row.status : 'pending') as ShortStoryBatchScheduleStatus,
    storyIds: JSON.parse(row.story_ids_json) as string[],
    error: row.error,
    executedAt: row.executed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- 查询 ----------

export function getBatchSchedule(id: string): ShortStoryBatchSchedule {
  const row = getDb().prepare('SELECT * FROM short_story_batch_schedules WHERE id = ?').get(id) as
    | ScheduleRow
    | undefined;
  if (!row) throw new CoreError('BATCH_SCHEDULE_NOT_FOUND', `批量定时计划不存在: ${id}`);
  return toSchedule(row);
}

export function tryGetBatchSchedule(id: string): ShortStoryBatchSchedule | null {
  const row = getDb().prepare('SELECT * FROM short_story_batch_schedules WHERE id = ?').get(id) as
    | ScheduleRow
    | undefined;
  return row ? toSchedule(row) : null;
}

export interface ListBatchSchedulesOptions {
  status?: string;
  limit?: number;
}

/** 列表按触发时间倒序;支持状态筛选 */
export function listBatchSchedules(opts?: ListBatchSchedulesOptions): ShortStoryBatchSchedule[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.status && isBatchStatus(opts.status)) {
    where.push('status = ?');
    params.push(opts.status);
  }
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 1000);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `SELECT * FROM short_story_batch_schedules ${whereSql} ORDER BY scheduled_at DESC, rowid DESC LIMIT ?`
    )
    .all(...params, limit) as ScheduleRow[];
  return rows.map(toSchedule);
}

// ---------- 写入 ----------

export interface CreateBatchScheduleInput {
  /** 触发时间(UTC ISO 串,精度到分钟) */
  scheduledAt: string;
  /** 到点生成的短篇数量(1..50) */
  count: number;
  /** 每篇共用的创作需求(可空=自由创作) */
  brief?: unknown;
}

/** 新建批量定时计划(初始 pending,由调度器到点触发) */
export function createBatchSchedule(input: CreateBatchScheduleInput): ShortStoryBatchSchedule {
  if (!input.scheduledAt || !Number.isFinite(Date.parse(input.scheduledAt))) {
    throw new CoreError('INVALID_INPUT', `非法的定时时间: ${String(input.scheduledAt)}`);
  }
  const count = Math.round(Number(input.count));
  if (!Number.isFinite(count) || count < 1 || count > 50) {
    throw new CoreError('INVALID_INPUT', `生成数量需为 1..50 的整数,当前: ${String(input.count)}`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = genId('bss');
  db.prepare(
    `INSERT INTO short_story_batch_schedules
       (id, scheduled_at, count, brief_json, status, story_ids_json, error, created_at, updated_at, executed_at)
     VALUES (?, ?, ?, ?, 'pending', '[]', NULL, ?, ?, NULL)`
  ).run(id, new Date(input.scheduledAt).toISOString(), count, JSON.stringify(normalizeBrief(input.brief)), now, now);
  return getBatchSchedule(id);
}

/** 取消未触发的批量定时计划;仅 pending 可取消 */
export function cancelBatchSchedule(id: string): ShortStoryBatchSchedule {
  const current = getBatchSchedule(id);
  if (current.status !== 'pending') {
    throw new CoreError('INVALID_INPUT', `当前状态 ${current.status} 没有挂起的批量定时任务`);
  }
  const db = getDb();
  db.prepare(
    `UPDATE short_story_batch_schedules SET status = 'cancelled', updated_at = ? WHERE id = ?`
  ).run(new Date().toISOString(), id);
  return getBatchSchedule(id);
}

/** 删除批量定时记录;执行中禁止删除(避免与调度器竞态),其余状态可删 */
export function deleteBatchSchedule(id: string): void {
  const current = getBatchSchedule(id);
  if (current.status === 'executing') {
    throw new CoreError('INVALID_INPUT', `批量定时正在执行中,不可删除`);
  }
  getDb().prepare('DELETE FROM short_story_batch_schedules WHERE id = ?').run(id);
}

// ---------- 调度器 ----------

/** 调度器扫描:返回所有已到点(pending 且 scheduled_at <= now)的批量定时计划 */
export function listDueBatchSchedules(now = new Date()): ShortStoryBatchSchedule[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM short_story_batch_schedules
       WHERE status = 'pending' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC, rowid ASC`
    )
    .all(now.toISOString()) as ScheduleRow[];
  return rows.map(toSchedule);
}

/**
 * 到点执行:原子认领(pending → executing),然后逐篇创建短篇(标题留空,由流水线自动生成)
 * 并入队 CREATE_NOVEL;全部入队后置 done 并记录 story_ids。中途失败置 failed(error 可见),
 * 已创建的故事保留(可手动重试/删除),下轮不会重复触发(状态已非 pending)。
 */
export function fireBatchSchedule(id: string): { schedule: ShortStoryBatchSchedule; createdStoryIds: string[] } {
  const db = getDb();
  const now = new Date().toISOString();
  const claimed = db
    .prepare(
      `UPDATE short_story_batch_schedules SET status = 'executing', updated_at = ? WHERE id = ? AND status = 'pending'`
    )
    .run(now, id);
  if (claimed.changes === 0) {
    const current = getBatchSchedule(id);
    throw new CoreError('INVALID_INPUT', `批量定时计划状态为 ${current.status},不可触发`);
  }
  const schedule = getBatchSchedule(id);
  const created: string[] = [];
  try {
    for (let i = 0; i < schedule.count; i++) {
      // 标题不填 → '未命名短篇' 占位,由 runCreationPipeline 采用 LLM 首行标题
      const story = createShortStory({ brief: schedule.brief });
      enqueueCreationPipeline(story.id);
      created.push(story.id);
    }
    db.prepare(
      `UPDATE short_story_batch_schedules
       SET status = 'done', story_ids_json = ?, executed_at = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(created), now, now, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE short_story_batch_schedules
       SET status = 'failed', story_ids_json = ?, error = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(created), message.slice(0, 4000), now, id);
    throw err;
  }
  return { schedule: getBatchSchedule(id), createdStoryIds: created };
}
