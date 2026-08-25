// V9 短篇小说服务:CRUD + 版本追加(只增不改) + 状态流转
// 版本表是事实链:AI 优化/用户编辑一律产生新版本行,历史版本内容永不 UPDATE(规格书 §43)

import { getDb, genId } from './db';
import {
  CoreError,
  isShortStoryStatus,
  isVersionCreationReason,
  SHORT_STORY_DELETABLE_STATUSES,
  type ShortStory,
  type ShortStoryStatus,
  type ShortStoryVersion,
  type StoryBrief,
  type VersionCreationReason,
} from './domain';

// ---------- brief 归一化 ----------

const BRIEF_STRING_FIELDS = [
  'theme',
  'genre',
  'direction',
  'coreConflict',
  'background',
  'characters',
  'synopsis',
  'beginning',
  'development',
  'conflictBeat',
  'climax',
  'endingPlot',
  'narrativePerspective',
  'languageStyle',
  'emotionalTone',
  'pacing',
  'endingType',
] as const;

const BRIEF_FIELD_MAX = 8000;

/**
 * 白名单式归一化创作需求:仅接受已知字段,字符串 trim 并限长,
 * targetWords 取正整数(100..200000)。未知字段静默丢弃,保证落库形状稳定。
 */
export function normalizeBrief(input: unknown): StoryBrief {
  const brief: StoryBrief = {};
  if (typeof input !== 'object' || input === null) return brief;
  const raw = input as Record<string, unknown>;
  for (const key of BRIEF_STRING_FIELDS) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) {
      brief[key] = v.trim().slice(0, BRIEF_FIELD_MAX);
    }
  }
  if (raw.targetWords !== undefined && raw.targetWords !== null && raw.targetWords !== '') {
    const n = Number(raw.targetWords);
    if (Number.isFinite(n)) {
      brief.targetWords = Math.min(200000, Math.max(100, Math.round(n)));
    }
  }
  return brief;
}

// ---------- 行映射 ----------

interface StoryRow {
  id: string;
  title: string;
  status: string;
  brief_json: string;
  current_version_id: string | null;
  source_url: string | null;
  review_round: number;
  optimize_round: number;
  manual_optimize_round: number;
  last_score: number | null;
  created_at: string;
  updated_at: string;
}

function parseJsonSafe<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toStory(row: StoryRow): ShortStory {
  return {
    id: row.id,
    title: row.title,
    status: (isShortStoryStatus(row.status) ? row.status : 'draft') as ShortStoryStatus,
    brief: parseJsonSafe<StoryBrief>(row.brief_json, {}),
    currentVersionId: row.current_version_id,
    sourceUrl: row.source_url,
    reviewRound: row.review_round,
    optimizeRound: row.optimize_round,
    manualOptimizeRound: row.manual_optimize_round,
    lastScore: row.last_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface VersionRow {
  id: string;
  story_id: string;
  version: number;
  content: string;
  char_count: number;
  creation_reason: string;
  generation_prompt: string | null;
  model_name: string | null;
  is_final: number;
  created_at: string;
}

function toVersion(row: VersionRow): ShortStoryVersion {
  return {
    id: row.id,
    storyId: row.story_id,
    version: row.version,
    content: row.content,
    charCount: row.char_count,
    creationReason: (isVersionCreationReason(row.creation_reason)
      ? row.creation_reason
      : 'generated') as VersionCreationReason,
    generationPrompt: row.generation_prompt,
    modelName: row.model_name,
    isFinal: row.is_final === 1,
    createdAt: row.created_at,
  };
}

// ---------- 查询 ----------

export function getShortStory(id: string): ShortStory {
  const row = getDb().prepare('SELECT * FROM short_stories WHERE id = ?').get(id) as StoryRow | undefined;
  if (!row) throw new CoreError('SHORT_STORY_NOT_FOUND', `短篇小说不存在: ${id}`);
  return toStory(row);
}

export function tryGetShortStory(id: string): ShortStory | null {
  const row = getDb().prepare('SELECT * FROM short_stories WHERE id = ?').get(id) as StoryRow | undefined;
  return row ? toStory(row) : null;
}

export interface ListShortStoriesOptions {
  status?: string;
  q?: string;
  limit?: number;
}

export interface ShortStoryListItem extends ShortStory {
  versionCount: number;
}

/** 列表按更新时间倒序;支持状态筛选与标题模糊匹配;q 为空返回全量(admin 惯例:客户端过滤) */
export function listShortStories(opts?: ListShortStoriesOptions): ShortStoryListItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.status && isShortStoryStatus(opts.status)) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (opts?.q?.trim()) {
    where.push('title LIKE ?');
    params.push(`%${opts.q.trim()}%`);
  }
  const limit = Math.min(Math.max(opts?.limit ?? 500, 1), 1000);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM short_story_versions v WHERE v.story_id = s.id) AS version_count
       FROM short_stories s ${whereSql} ORDER BY s.updated_at DESC LIMIT ?`
    )
    .all(...params, limit) as (StoryRow & { version_count: number })[];
  return rows.map((row) => ({ ...toStory(row), versionCount: row.version_count }));
}

export function getStoryVersion(versionId: string): ShortStoryVersion {
  const row = getDb().prepare('SELECT * FROM short_story_versions WHERE id = ?').get(versionId) as
    | VersionRow
    | undefined;
  if (!row) throw new CoreError('SHORT_STORY_VERSION_NOT_FOUND', `小说版本不存在: ${versionId}`);
  return toVersion(row);
}

export function listStoryVersions(storyId: string): ShortStoryVersion[] {
  const rows = getDb()
    .prepare('SELECT * FROM short_story_versions WHERE story_id = ? ORDER BY version ASC')
    .all(storyId) as VersionRow[];
  return rows.map(toVersion);
}

/** 详情聚合:主档 + 全部版本(前端一次拉取渲染版本时间线) */
export function getStoryDetail(storyId: string): { story: ShortStory; versions: ShortStoryVersion[] } {
  return { story: getShortStory(storyId), versions: listStoryVersions(storyId) };
}

// ---------- 写入 ----------

export interface CreateShortStoryInput {
  title?: string;
  brief?: unknown;
  sourceUrl?: string | null;
}

export function createShortStory(input?: CreateShortStoryInput): ShortStory {
  const db = getDb();
  const now = new Date().toISOString();
  const id = genId('ss');
  const title = input?.title?.trim() || '未命名短篇';
  const brief = normalizeBrief(input?.brief);
  const sourceUrl = input?.sourceUrl?.trim() || null;
  db.prepare(
    `INSERT INTO short_stories (id, title, status, brief_json, current_version_id, source_url, review_round, optimize_round, last_score, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, NULL, ?, 0, 0, NULL, ?, ?)`
  ).run(id, title.slice(0, 200), JSON.stringify(brief), sourceUrl, now, now);
  return getShortStory(id);
}

export interface UpdateShortStoryPatch {
  title?: string;
  brief?: unknown;
  sourceUrl?: string | null;
}

/** 编辑主档元数据;brief 整体替换(归一化后),sourceUrl 传 null 清除。不动任何版本行。 */
export function updateShortStory(id: string, patch: UpdateShortStoryPatch): ShortStory {
  const current = getShortStory(id);
  const db = getDb();
  const nextTitle = patch.title !== undefined ? patch.title.trim().slice(0, 200) || current.title : current.title;
  const nextBrief =
    patch.brief !== undefined ? normalizeBrief(patch.brief) : current.brief;
  let nextSourceUrl = current.sourceUrl;
  if (patch.sourceUrl !== undefined) {
    nextSourceUrl = typeof patch.sourceUrl === 'string' ? patch.sourceUrl.trim() || null : null;
  }
  db.prepare('UPDATE short_stories SET title = ?, brief_json = ?, source_url = ?, updated_at = ? WHERE id = ?').run(
    nextTitle,
    JSON.stringify(nextBrief),
    nextSourceUrl,
    new Date().toISOString(),
    id
  );
  return getShortStory(id);
}

export interface AppendVersionInput {
  content: string;
  creationReason: VersionCreationReason;
  generationPrompt?: string | null;
  modelName?: string | null;
}

/**
 * 追加新版本:事务内取 max(version)+1,同步推进 current_version_id。
 * 内容一经写入永不修改——修订请继续追加新版本。
 */
export function appendVersion(storyId: string, input: AppendVersionInput): ShortStoryVersion {
  const content = input.content?.trim();
  if (!content) throw new CoreError('INVALID_INPUT', '版本正文不能为空');
  if (!isVersionCreationReason(input.creationReason)) {
    throw new CoreError('INVALID_INPUT', `非法的版本产生原因: ${String(input.creationReason)}`);
  }
  const db = getDb();
  getShortStory(storyId); // 存在性守卫
  const tx = db.transaction((): string => {
    const now = new Date().toISOString();
    const next = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM short_story_versions WHERE story_id = ?').get(storyId) as { v: number }).v + 1;
    const vid = genId('ssv');
    db.prepare(
      `INSERT INTO short_story_versions (id, story_id, version, content, char_count, creation_reason, generation_prompt, model_name, is_final, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(vid, storyId, next, content, content.length, input.creationReason, input.generationPrompt ?? null, input.modelName ?? null, now);
    db.prepare('UPDATE short_stories SET current_version_id = ?, updated_at = ? WHERE id = ?').run(vid, now, storyId);
    return vid;
  });
  return getStoryVersion(tx());
}

/** 设定最终版本:清除该书其余 is_final 后标记目标版本,并同步 current_version_id */
export function setFinalVersion(storyId: string, versionId: string): ShortStoryVersion {
  const target = getStoryVersion(versionId);
  if (target.storyId !== storyId) throw new CoreError('INVALID_INPUT', '版本不属于该小说');
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('UPDATE short_story_versions SET is_final = 0 WHERE story_id = ?').run(storyId);
    db.prepare('UPDATE short_story_versions SET is_final = 1 WHERE id = ?').run(versionId);
    db.prepare('UPDATE short_stories SET current_version_id = ?, updated_at = ? WHERE id = ?').run(
      versionId,
      new Date().toISOString(),
      storyId
    );
  });
  tx();
  return getStoryVersion(versionId);
}

/** 状态流转(供流水线/引擎驱动;此处只做枚举校验,不做 FSM 限制) */
export function transitionStory(id: string, status: ShortStoryStatus): ShortStory {
  if (!isShortStoryStatus(status)) throw new CoreError('INVALID_INPUT', `非法状态: ${String(status)}`);
  getShortStory(id);
  getDb().prepare('UPDATE short_stories SET status = ?, updated_at = ? WHERE id = ?').run(
    status,
    new Date().toISOString(),
    id
  );
  return getShortStory(id);
}

/** 评审/优化轮次自增(引擎每次执行后调用),并回写最近评分 */
export function bumpStoryProgress(
  id: string,
  patch: { reviewDelta?: number; optimizeDelta?: number; manualOptimizeDelta?: number; lastScore?: number }
): ShortStory {
  getShortStory(id);
  const db = getDb();
  db.prepare(
    `UPDATE short_stories SET
       review_round = review_round + ?,
       optimize_round = optimize_round + ?,
       manual_optimize_round = manual_optimize_round + ?,
       last_score = COALESCE(?, last_score),
       updated_at = ?
     WHERE id = ?`
  ).run(
    patch.reviewDelta ?? 0,
    patch.optimizeDelta ?? 0,
    patch.manualOptimizeDelta ?? 0,
    patch.lastScore ?? null,
    new Date().toISOString(),
    id
  );
  return getShortStory(id);
}

/** 仅 draft/pool/failed 可删;删除级联清理版本(评审记录保留作历史数据) */
export function deleteShortStory(id: string): void {
  const story = getShortStory(id);
  if (!SHORT_STORY_DELETABLE_STATUSES.includes(story.status)) {
    throw new CoreError('INVALID_INPUT', `当前状态 ${story.status} 不允许删除(仅草稿/低质量池/失败可删)`);
  }
  getDb().prepare('DELETE FROM short_stories WHERE id = ?').run(id);
}
