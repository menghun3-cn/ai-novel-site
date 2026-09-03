// V9 统一 AI 任务(规格书 §35):创建/领取/完成/失败/重试/查询
// 只做状态账本;具体执行由 pipeline 与 assist 执行器完成,web 层 worker 负责循环领取

import { getDb, genId } from './db';
import {
  CoreError,
  isAiTaskStatus,
  isAiTaskType,
  type AiTask,
  type AiTaskStatus,
  type AiTaskType,
} from './domain';

interface TaskRow {
  id: string;
  type: string;
  status: string;
  ref_type: string | null;
  ref_id: string | null;
  input_json: string | null;
  prompt: string | null;
  provider_name: string | null;
  model_name: string | null;
  output_json: string | null;
  error: string | null;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  tokens_prompt: number | null;
  tokens_completion: number | null;
  created_at: string;
}

function parseJsonObj(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toTask(row: TaskRow): AiTask {
  return {
    id: row.id,
    type: (isAiTaskType(row.type) ? row.type : 'AI_GENERATE') as AiTaskType,
    status: (isAiTaskStatus(row.status) ? row.status : 'PENDING') as AiTaskStatus,
    refType: row.ref_type,
    refId: row.ref_id,
    input: parseJsonObj(row.input_json),
    prompt: row.prompt,
    providerName: row.provider_name,
    modelName: row.model_name,
    output: parseJsonObj(row.output_json),
    error: row.error,
    attempt: row.attempt,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    tokensPrompt: row.tokens_prompt,
    tokensCompletion: row.tokens_completion,
    createdAt: row.created_at,
  };
}

function getTaskRow(id: string): TaskRow {
  const row = getDb().prepare('SELECT * FROM ai_tasks WHERE id = ?').get(id) as TaskRow | undefined;
  if (!row) throw new CoreError('AI_TASK_NOT_FOUND', `AI 任务不存在: ${id}`);
  return row;
}

export function getAiTask(id: string): AiTask {
  return toTask(getTaskRow(id));
}

export interface ListAiTasksOptions {
  type?: string;
  status?: string;
  refType?: string;
  refId?: string;
  limit?: number;
}

/** 任务列表,创建时间倒序;admin 惯例全量拉取 + 客户端过滤,这里仅提供服务端常用过滤 */
export function listAiTasks(opts?: ListAiTasksOptions): AiTask[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.type && isAiTaskType(opts.type)) {
    where.push('type = ?');
    params.push(opts.type);
  }
  if (opts?.status && isAiTaskStatus(opts.status)) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts?.refType?.trim()) {
    where.push('ref_type = ?');
    params.push(opts.refType.trim());
  }
  if (opts?.refId?.trim()) {
    where.push('ref_id = ?');
    params.push(opts.refId.trim());
  }
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 1000);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM ai_tasks ${whereSql} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as TaskRow[];
  return rows.map(toTask);
}

export interface CreateAiTaskInput {
  type: AiTaskType;
  refType?: string | null;
  refId?: string | null;
  input?: Record<string, unknown> | null;
  prompt?: string | null;
}

export function createAiTask(input: CreateAiTaskInput): AiTask {
  if (!isAiTaskType(input.type)) throw new CoreError('INVALID_INPUT', `非法任务类型: ${String(input.type)}`);
  const db = getDb();
  const id = genId('aitask');
  db.prepare(
    'INSERT INTO ai_tasks (id, type, status, ref_type, ref_id, input_json, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    input.type,
    'PENDING',
    input.refType ?? null,
    input.refId ?? null,
    input.input ? JSON.stringify(input.input) : null,
    input.prompt ?? null,
    new Date().toISOString()
  );
  return getAiTask(id);
}

/** 领取执行:PENDING→RUNNING,attempt+1 并记录开始时间与模型信息 */
export function startAiTask(
  id: string,
  info?: { providerName?: string | null; modelName?: string | null; prompt?: string | null }
): AiTask {
  const row = getTaskRow(id);
  if (row.status !== 'PENDING') {
    throw new CoreError('INVALID_INPUT', `任务 ${id} 状态为 ${row.status},不可领取`);
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE ai_tasks SET status = 'RUNNING', attempt = attempt + 1, started_at = ?,
         provider_name = COALESCE(?, provider_name), model_name = COALESCE(?, model_name),
         prompt = COALESCE(?, prompt), error = NULL
       WHERE id = ?`
    )
    .run(now, info?.providerName ?? null, info?.modelName ?? null, info?.prompt ?? null, id);
  return getAiTask(id);
}

export interface CompleteAiTaskInput {
  output?: Record<string, unknown> | null;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
}

export function completeAiTask(id: string, result?: CompleteAiTaskInput): AiTask {
  const row = getTaskRow(id);
  const now = new Date().toISOString();
  const durationMs = row.started_at ? Math.max(0, Date.now() - Date.parse(row.started_at)) : null;
  getDb()
    .prepare(
      `UPDATE ai_tasks SET status = 'SUCCESS', finished_at = ?, duration_ms = ?,
         output_json = COALESCE(?, output_json), error = NULL,
         tokens_prompt = COALESCE(?, tokens_prompt), tokens_completion = COALESCE(?, tokens_completion)
       WHERE id = ?`
    )
    .run(
      now,
      durationMs,
      result?.output ? JSON.stringify(result.output) : null,
      result?.tokensPrompt ?? null,
      result?.tokensCompletion ?? null,
      id
    );
  return getAiTask(id);
}

export function failAiTask(id: string, error: string, partialOutput?: Record<string, unknown> | null): AiTask {
  getTaskRow(id);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE ai_tasks SET status = 'FAILED', finished_at = ?, error = ?,
         output_json = COALESCE(?, output_json)
       WHERE id = ?`
    )
    .run(now, error.slice(0, 4000), partialOutput ? JSON.stringify(partialOutput) : null, id);
  return getAiTask(id);
}

/** 重试失败任务:FAILED→PENDING;attempt 不清零(保留历史尝试次数) */
export function retryAiTask(id: string): AiTask {
  const row = getTaskRow(id);
  if (row.status !== 'FAILED') {
    throw new CoreError('INVALID_INPUT', `仅 FAILED 任务可重试,当前 ${row.status}`);
  }
  getDb().prepare("UPDATE ai_tasks SET status = 'PENDING', error = NULL, finished_at = NULL WHERE id = ?").run(id);
  return getAiTask(id);
}

/** 取消排队任务(仅 PENDING;运行中任务不可取消——进程内 worker 无法中断进行中的 LLM 调用) */
export function cancelAiTask(id: string): AiTask {
  const row = getTaskRow(id);
  if (row.status !== 'PENDING') {
    throw new CoreError('INVALID_INPUT', `仅 PENDING 任务可取消,当前 ${row.status}`);
  }
  getDb()
    .prepare("UPDATE ai_tasks SET status = 'CANCELLED', finished_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
  return getAiTask(id);
}

/** 领取一批待处理任务(FIFO);供 processAiTasks 循环调用 */
export function claimPendingTasks(limit: number): AiTask[] {
  const rows = getDb()
    .prepare("SELECT * FROM ai_tasks WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT ?")
    .all(Math.max(1, limit)) as TaskRow[];
  return rows.map(toTask);
}

/**
 * 僵尸 RUNNING 任务恢复:started_at 早于 now - maxAgeMs 仍为 RUNNING 的任务,
 * 判定执行进程已消失(容器重建/崩溃/被杀),重置回 PENDING 供调度器重新认领。
 * - 只清执行痕迹(started_at/finished_at/duration_ms/error/output),attempt 保留历史尝试次数
 * - 阈值必须大于正常任务最长耗时(整篇生成约 3 分钟)以免误伤正在执行的任务
 * - 由调度器 tick 调用(web 侧 story-worker 不做恢复,防止与执行中的任务双跑)
 */
export function recoverStaleRunningTasks(maxAgeMs = 10 * 60 * 1000): AiTask[] {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const rows = getDb()
    .prepare(
      "SELECT * FROM ai_tasks WHERE status = 'RUNNING' AND started_at IS NOT NULL AND started_at < ?"
    )
    .all(cutoff) as TaskRow[];
  if (rows.length === 0) return [];
  const db = getDb();
  const tx = db.transaction(() => {
    const reset = db.prepare(
      `UPDATE ai_tasks SET status = 'PENDING', started_at = NULL, finished_at = NULL,
         duration_ms = NULL, error = NULL, output_json = NULL
       WHERE id = ?`
    );
    for (const row of rows) reset.run(row.id);
  });
  tx();
  return rows.map(toTask);
}
