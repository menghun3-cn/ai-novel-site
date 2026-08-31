// V9.6 批量定时创作:一个计划 = 到点创建 count 篇短篇并逐篇入队创作流水线。
// V9.7 支持每天重复:repeat_daily=1 时按 scheduled_at 的时刻每天触发一次(同日去重)。
// 与单篇定时(short-stories.scheduled_at)互补:单篇定时管"这一篇到点开始写",
// 批量定时管"到点按同一份创作需求批量生成 N 篇";标题不填时由流水线自动生成,
// 每篇独立走 生成 → 评审 → (达标)自动发布 闭环。
// 创建故事与入队均为本地 DB 操作(无 LLM 调用),到点执行瞬时完成。

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

/** 服务器本地时区日期键(YYYY-MM-DD),用于每日计划的同日去重 */
function localDateKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 服务器本地时区时刻键(HH:MM),用于每日计划"今天时刻已到"判定 */
function localTimeKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ScheduleRow {
  id: string;
  scheduled_at: string;
  count: number;
  brief_json: string;
  status: string;
  story_ids_json: string;
  error: string | null;
  repeat_daily: number;
  last_fired_date: string | null;
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
    repeatDaily: row.repeat_daily === 1,
    lastFiredDate: row.last_fired_date,
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

function normalizeScheduledAt(v: unknown): string {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) {
    throw new CoreError('INVALID_INPUT', `非法的定时时间: ${String(v)}`);
  }
  return new Date(v).toISOString();
}

function normalizeCount(v: unknown): number {
  const count = Math.round(Number(v));
  if (!Number.isFinite(count) || count < 1 || count > 50) {
    throw new CoreError('INVALID_INPUT', `生成数量需为 1..50 的整数,当前: ${String(v)}`);
  }
  return count;
}

export interface CreateBatchScheduleInput {
  /** 触发时间(UTC ISO 串,精度到分钟;每日计划取其中的本地时刻每天触发) */
  scheduledAt: string;
  /** 到点生成的短篇数量(1..50) */
  count: number;
  /** 每篇共用的创作需求(可空=自由创作) */
  brief?: unknown;
  /** 是否每天同一时刻重复触发(默认 false=一次性) */
  repeatDaily?: boolean;
}

/** 新建批量定时计划(初始 pending,由调度器到点触发) */
export function createBatchSchedule(input: CreateBatchScheduleInput): ShortStoryBatchSchedule {
  const scheduledAt = normalizeScheduledAt(input.scheduledAt);
  const count = normalizeCount(input.count);
  const db = getDb();
  const now = new Date().toISOString();
  const id = genId('bss');
  db.prepare(
    `INSERT INTO short_story_batch_schedules
       (id, scheduled_at, count, brief_json, status, story_ids_json, error, repeat_daily, last_fired_date, created_at, updated_at, executed_at)
     VALUES (?, ?, ?, ?, 'pending', '[]', NULL, ?, NULL, ?, ?, NULL)`
  ).run(
    id,
    scheduledAt,
    count,
    JSON.stringify(normalizeBrief(input.brief)),
    input.repeatDaily ? 1 : 0,
    now,
    now
  );
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

export interface UpdateBatchScheduleInput {
  /** 新的触发时间(UTC ISO 串,精度到分钟;每日计划取其中的本地时刻每天触发) */
  scheduledAt?: string;
  /** 新的到点生成数量(1..50) */
  count?: number;
  /** 新的每篇共用创作需求(可空=自由创作) */
  brief?: unknown;
  /** 新的重复模式(是否每天同一时刻重复触发) */
  repeatDaily?: boolean;
}

/**
 * 修改批量定时计划(未触发的管理:如把 10:00 改为 10:30)。
 * - 仅 pending(含每日重复待触发)与 failed 可修改;executing/done/cancelled 不可改。
 * - failed 修改后自动重置为 pending(重新挂起,error 清空),到点(或次日时刻)再次触发。
 * - 每日计划的 last_fired_date 保留(同日去重:已触发过则修改后的时刻次日生效)。
 * - 仅提供部分字段时其余保持原值。
 */
export function updateBatchSchedule(id: string, input: UpdateBatchScheduleInput): ShortStoryBatchSchedule {
  const current = getBatchSchedule(id);
  if (current.status !== 'pending' && current.status !== 'failed') {
    throw new CoreError('INVALID_INPUT', `当前状态 ${current.status} 不可修改批量定时计划`);
  }
  const scheduledAt = input.scheduledAt !== undefined ? normalizeScheduledAt(input.scheduledAt) : current.scheduledAt;
  const count = input.count !== undefined ? normalizeCount(input.count) : current.count;
  const brief = input.brief !== undefined ? normalizeBrief(input.brief) : current.brief;
  const repeatDaily = input.repeatDaily !== undefined ? input.repeatDaily : current.repeatDaily;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE short_story_batch_schedules
     SET scheduled_at = ?, count = ?, brief_json = ?, repeat_daily = ?, status = 'pending', error = NULL, updated_at = ?
     WHERE id = ?`
  ).run(scheduledAt, count, JSON.stringify(brief), repeatDaily ? 1 : 0, now, id);
  return getBatchSchedule(id);
}

// ---------- 调度器 ----------

/**
 * 调度器扫描:返回本次 tick 应触发的批量定时计划。
 * - 一次性:status='pending' 且 scheduled_at <= now(到点即触发,含历史补触发)
 * - 每日重复:status='pending' 且今天尚未触发(last_fired_date != 今天),且今天本地时刻
 *   已到达 scheduled_at 的本地时刻(避免创建日时刻已过就立即补触发,次日开始按时触发)
 */
export function listDueBatchSchedules(now = new Date()): ShortStoryBatchSchedule[] {
  const today = localDateKey(now);
  const rows = getDb()
    .prepare(
      `SELECT * FROM short_story_batch_schedules
       WHERE status = 'pending' AND (
         (repeat_daily = 0 AND scheduled_at <= ?)
         OR (repeat_daily = 1 AND (last_fired_date IS NULL OR last_fired_date != ?))
       )
       ORDER BY scheduled_at ASC, rowid ASC`
    )
    .all(now.toISOString(), today) as ScheduleRow[];
  return rows.map(toSchedule).filter((s) => {
    if (!s.repeatDaily) return true;
    return localTimeKey(now) >= localTimeKey(new Date(s.scheduledAt));
  });
}

/**
 * 到点执行:原子认领(pending → executing),然后逐篇创建短篇(标题留空,由流水线自动生成)
 * 并入队 CREATE_NOVEL。
 * - 一次性:全部入队后置 done 并记录 story_ids;失败置 failed(error 可见),下轮不再重复触发
 * - 每日重复:成功后保持 pending 并记录 last_fired_date=今天(同日去重,次日再触发),
 *   story_ids 跨日累积;失败保持 pending 并记录 error(跳过今天,次日自动重试)
 * now 可注入用于测试跨日场景;已创建的故事保留。
 */
export function fireBatchSchedule(
  id: string,
  opts?: { now?: Date }
): { schedule: ShortStoryBatchSchedule; createdStoryIds: string[] } {
  const db = getDb();
  const now = opts?.now ?? new Date();
  const nowIso = now.toISOString();
  const claimed = db
    .prepare(
      `UPDATE short_story_batch_schedules SET status = 'executing', updated_at = ? WHERE id = ? AND status = 'pending'`
    )
    .run(nowIso, id);
  if (claimed.changes === 0) {
    const current = getBatchSchedule(id);
    throw new CoreError('INVALID_INPUT', `批量定时计划状态为 ${current.status},不可触发`);
  }
  const schedule = getBatchSchedule(id);
  // 每日计划同日去重守卫:即使绕过 listDue 直接触发,同一天也只执行一次(回滚到 pending 等待次日)
  if (schedule.repeatDaily && schedule.lastFiredDate === localDateKey(now)) {
    db.prepare(
      `UPDATE short_story_batch_schedules SET status = 'pending', updated_at = ? WHERE id = ?`
    ).run(nowIso, id);
    throw new CoreError('INVALID_INPUT', '该每日计划今天已触发过');
  }
  const created: string[] = [];
  try {
    for (let i = 0; i < schedule.count; i++) {
      // 标题不填 → '未命名短篇' 占位,由 runCreationPipeline 采用 LLM 首行标题
      const story = createShortStory({ brief: schedule.brief });
      enqueueCreationPipeline(story.id);
      created.push(story.id);
    }
    const allIds = [...schedule.storyIds, ...created];
    if (schedule.repeatDaily) {
      // 每日计划触发成功:回置 pending + 记录今天,等待次日再触发
      db.prepare(
        `UPDATE short_story_batch_schedules
         SET status = 'pending', last_fired_date = ?, story_ids_json = ?, error = NULL, updated_at = ? WHERE id = ?`
      ).run(localDateKey(now), JSON.stringify(allIds), nowIso, id);
    } else {
      db.prepare(
        `UPDATE short_story_batch_schedules
         SET status = 'done', story_ids_json = ?, executed_at = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(allIds), nowIso, nowIso, id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const allIds = [...schedule.storyIds, ...created];
    if (schedule.repeatDaily) {
      // 每日计划失败不终止:回置 pending + 记录 error 并跳过今天,次日自动重试
      db.prepare(
        `UPDATE short_story_batch_schedules
         SET status = 'pending', last_fired_date = ?, story_ids_json = ?, error = ?, updated_at = ? WHERE id = ?`
      ).run(localDateKey(now), JSON.stringify(allIds), message.slice(0, 4000), nowIso, id);
    } else {
      db.prepare(
        `UPDATE short_story_batch_schedules
         SET status = 'failed', story_ids_json = ?, error = ?, updated_at = ? WHERE id = ?`
      ).run(JSON.stringify(allIds), message.slice(0, 4000), nowIso, id);
    }
    throw err;
  }
  return { schedule: getBatchSchedule(id), createdStoryIds: created };
}
