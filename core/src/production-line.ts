// V10 内容工厂:产线(Production Line)服务
// 产线 = 一组题材/类型模板(kinds,含 brief 基线 + 种子池)+ 调度 + 配额 + 质量闸门配置。
// 一次运行(run)按 kinds 的 weight 分配 count 篇「不同题材/类型」的短篇;
// 每篇由 产线基线 ⊕ 题材 brief ⊕ 种子 合成一份差异化创作需求,复用既有短篇创作流水线
// (生成 → 评审 → 自动优化 → 再评审 → 达标自动发布/入池),标题未填时由 LLM 自动生成。

import { getDb, genId } from './db';
import {
  CoreError,
  isProductionRunStatus,
  type ProductionKindSeed,
  type ProductionKindTemplate,
  type ProductionLine,
  type ProductionLineConfig,
  type ProductionRun,
  type ProductionRunItem,
  type ProductionRunStatus,
  type StoryBrief,
} from './domain';
import { createShortStory } from './short-story';
import { enqueueCreationPipeline } from './short-story-pipeline';
import { normalizeBrief } from './short-story';

// ---------- 工具 ----------

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function clampInt(v: number, min: number, max: number, label: string): number {
  const n = Math.round(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new CoreError('INVALID_LINE_CONFIG', `${label} 需为 ${min}..${max} 的整数,当前: ${String(v)}`);
  }
  return n;
}

/** 服务器本地日期键(YYYY-MM-DD),用于每日产线同日去重 */
function localDateKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- 配置归一化 ----------

function normalizeKind(raw: unknown, index: number): ProductionKindTemplate {
  if (typeof raw !== 'object' || raw === null) {
    throw new CoreError('INVALID_LINE_CONFIG', `第 ${index + 1} 个题材配置必须是对象`);
  }
  const k = raw as Record<string, unknown>;
  const genre = str(k.genre, 40);
  if (!genre) throw new CoreError('INVALID_LINE_CONFIG', `第 ${index + 1} 个题材缺少有效的 genre`);
  const weight = num(k.weight) === undefined ? 1 : clampInt(num(k.weight) as number, 1, 1000, `题材「${genre}」的权重`);
  const brief = k.brief !== undefined ? normalizeBrief(k.brief) : {};
  const seeds: ProductionKindSeed[] = [];
  if (Array.isArray(k.seeds)) {
    for (const s of k.seeds) {
      if (typeof s !== 'object' || s === null) continue;
      const sd = s as Record<string, unknown>;
      seeds.push({
        title: str(sd.title, 200) || undefined,
        theme: str(sd.theme, 8000) || undefined,
        synopsis: str(sd.synopsis, 8000) || undefined,
        coreConflict: str(sd.coreConflict, 8000) || undefined,
        background: str(sd.background, 8000) || undefined,
        characters: str(sd.characters, 8000) || undefined,
        direction: str(sd.direction, 8000) || undefined,
      });
    }
  }
  const kind: ProductionKindTemplate = { genre, weight, brief };
  if (seeds.length > 0) kind.seeds = seeds;
  return kind;
}

/** 校验并归一化产线配置:题材非空、每题材权重合法、调度 count 合法、配额合法 */
export function normalizeLineConfig(input: unknown): ProductionLineConfig {
  const cfg = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const kindsRaw = Array.isArray(cfg.kinds) ? cfg.kinds : [];
  if (kindsRaw.length === 0) {
    throw new CoreError('INVALID_LINE_CONFIG', '产线至少要配置一种题材/类型');
  }
  const kinds = kindsRaw.map(normalizeKind);
  const dup = new Set<string>();
  for (const k of kinds) {
    if (dup.has(k.genre)) throw new CoreError('INVALID_LINE_CONFIG', `题材重复: ${k.genre}`);
    dup.add(k.genre);
  }

  const scheduleRaw = (typeof cfg.schedule === 'object' && cfg.schedule !== null ? cfg.schedule : {}) as Record<string, unknown>;
  const mode = scheduleRaw.mode === 'daily' ? 'daily' : 'manual';
  let hour: number | undefined;
  if (mode === 'daily') hour = clampInt(num(scheduleRaw.hour) ?? 8, 0, 23, '每日触发小时');
  const count = clampInt(num(scheduleRaw.count) ?? 1, 1, 50, '每次触发篇数');

  const quotaRaw = (typeof cfg.quota === 'object' && cfg.quota !== null ? cfg.quota : {}) as Record<string, unknown>;
  const quota: ProductionLineConfig['quota'] = {};
  const maxPerRun = num(quotaRaw.maxPerRun);
  if (maxPerRun !== undefined) quota.maxPerRun = clampInt(maxPerRun, 1, 50, '单次上限');
  const dailyLimit = num(quotaRaw.dailyLimit);
  if (dailyLimit !== undefined) quota.dailyLimit = clampInt(dailyLimit, 1, 10000, '每日上限');
  const dailyBudgetUsd = num(quotaRaw.dailyBudgetUsd);
  if (dailyBudgetUsd !== undefined && Number.isFinite(dailyBudgetUsd) && dailyBudgetUsd >= 0) {
    quota.dailyBudgetUsd = Math.round(dailyBudgetUsd * 100) / 100;
  }
  quota.skipOnBudgetOverrun = quotaRaw.skipOnBudgetOverrun === true;

  const gateRaw = (typeof cfg.qualityGate === 'object' && cfg.qualityGate !== null ? cfg.qualityGate : {}) as Record<string, unknown>;
  const qualityGate: ProductionLineConfig['qualityGate'] = {};
  const minScore = num(gateRaw.minScore);
  if (minScore !== undefined) qualityGate.minScore = clampInt(minScore, 0, 100, '达标分数线');
  const reworkMaxRounds = num(gateRaw.reworkMaxRounds);
  if (reworkMaxRounds !== undefined) qualityGate.reworkMaxRounds = clampInt(reworkMaxRounds, 0, 20, '最大优化轮数');
  qualityGate.publishOnPass = gateRaw.publishOnPass !== false;

  const config: ProductionLineConfig = {
    kinds,
    schedule: { mode, ...(hour !== undefined ? { hour } : {}), count },
  };
  if (cfg.brief !== undefined) config.brief = normalizeBrief(cfg.brief);
  const targetWords = num(cfg.targetWords);
  if (targetWords !== undefined) config.targetWords = clampInt(targetWords, 100, 200000, '目标字数');
  const model = str(cfg.model, 100);
  if (model) config.model = model;
  const ruleId = str(cfg.ruleId, 60);
  if (ruleId) config.ruleId = ruleId;
  const promptId = str(cfg.promptId, 60);
  if (promptId) config.promptId = promptId;
  if (Object.keys(quota).length > 0) config.quota = quota;
  if (Object.keys(qualityGate).length > 0) config.qualityGate = qualityGate;
  return config;
}

// ---------- 行映射 ----------

interface LineRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  config_json: string;
  last_run_at: string | null;
  last_run_date: string | null;
  created_at: string;
  updated_at: string;
}

function toLine(row: LineRow): ProductionLine {
  let config: ProductionLineConfig;
  try {
    config = JSON.parse(row.config_json) as ProductionLineConfig;
  } catch {
    config = { kinds: [], schedule: { mode: 'manual', count: 1 } };
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled === 1,
    config,
    lastRunAt: row.last_run_at,
    lastRunDate: row.last_run_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------- 查询 ----------

export function getProductionLine(id: string): ProductionLine {
  const row = getDb().prepare('SELECT * FROM production_lines WHERE id = ?').get(id) as LineRow | undefined;
  if (!row) throw new CoreError('PRODUCTION_LINE_NOT_FOUND', `产线不存在: ${id}`);
  return toLine(row);
}

export function tryGetProductionLine(id: string): ProductionLine | null {
  const row = getDb().prepare('SELECT * FROM production_lines WHERE id = ?').get(id) as LineRow | undefined;
  return row ? toLine(row) : null;
}

export function listProductionLines(): ProductionLine[] {
  const rows = getDb()
    .prepare('SELECT * FROM production_lines ORDER BY created_at DESC, rowid DESC')
    .all() as LineRow[];
  return rows.map(toLine);
}

function setLineLastRun(id: string, now: Date): void {
  getDb()
    .prepare('UPDATE production_lines SET last_run_at = ?, last_run_date = ?, updated_at = ? WHERE id = ?')
    .run(now.toISOString(), localDateKey(now), now.toISOString(), id);
}

// ---------- 写入 ----------

export interface CreateProductionLineInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  config: unknown;
}

export function createProductionLine(input: CreateProductionLineInput): ProductionLine {
  const name = str(input.name, 100);
  if (!name) throw new CoreError('INVALID_LINE_CONFIG', '产线名称不能为空');
  const config = normalizeLineConfig(input.config);
  const db = getDb();
  const now = new Date().toISOString();
  const id = genId('pl');
  db.prepare(
    'INSERT INTO production_lines (id, name, description, enabled, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, input.description ? str(input.description, 500) : null, input.enabled === false ? 0 : 1, JSON.stringify(config), now, now);
  return getProductionLine(id);
}

export interface UpdateProductionLinePatch {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  config?: unknown;
}

export function updateProductionLine(id: string, patch: UpdateProductionLinePatch): ProductionLine {
  const current = getProductionLine(id);
  const nextName = patch.name !== undefined ? str(patch.name, 100) || current.name : current.name;
  const nextDescription =
    patch.description !== undefined
      ? patch.description
        ? str(patch.description, 500)
        : null
      : current.description;
  const nextEnabled = patch.enabled !== undefined ? patch.enabled : current.enabled;
  const nextConfig = patch.config !== undefined ? normalizeLineConfig(patch.config) : current.config;
  getDb()
    .prepare(
      'UPDATE production_lines SET name = ?, description = ?, enabled = ?, config_json = ?, updated_at = ? WHERE id = ?'
    )
    .run(nextName, nextDescription, nextEnabled ? 1 : 0, JSON.stringify(nextConfig), new Date().toISOString(), id);
  return getProductionLine(id);
}

export function setProductionLineEnabled(id: string, enabled: boolean): ProductionLine {
  getProductionLine(id);
  getDb()
    .prepare('UPDATE production_lines SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), id);
  return getProductionLine(id);
}

export function deleteProductionLine(id: string): void {
  getProductionLine(id);
  // 级联:production_runs + production_run_items 由外键 ON DELETE CASCADE 清理
  getDb().prepare('DELETE FROM production_lines WHERE id = ?').run(id);
}

// ---------- 混合题材分配 ----------

function kindSeedCount(kind: ProductionKindTemplate): number {
  return kind.seeds?.length ?? 0;
}

/** 为第 n 篇(该题材内序号)挑选种子下标:round-robin 保证同题材不同味 */
function pickSeedIndex(kind: ProductionKindTemplate, n: number): number | null {
  const len = kindSeedCount(kind);
  if (len === 0) return null;
  return n % len;
}

/**
 * 按 weight 分配 count 篇到各题材,保证多样性:
 * - count >= 题材数时,每个题材至少 1 篇;
 * - 其余按权重比例分配,余数轮转给权重最高者/依次补齐。
 */
export function assignRunKinds(config: ProductionLineConfig, count: number): ProductionRunItem[] {
  const kinds = config.kinds;
  const items: ProductionRunItem[] = [];
  if (kinds.length === 0) return items;
  if (kinds.length === 1) {
    const k = kinds[0];
    for (let i = 0; i < count; i++) items.push({ storyId: null, genre: k.genre, seedIndex: pickSeedIndex(k, i) });
    return items;
  }
  const weights = kinds.map((k) => Math.max(1, k.weight));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const alloc = kinds.map((_, i) => Math.floor((count * weights[i]) / totalWeight));
  let remaining = count - alloc.reduce((s, n) => s + n, 0);
  // 题材数不超篇数时,保证每题材至少 1 篇
  if (count >= kinds.length) {
    for (let i = 0; i < kinds.length; i++) {
      if (alloc[i] < 1) {
        alloc[i] = 1;
        remaining--;
      }
    }
  }
  // 按权重降序,轮转补齐余数
  const order = kinds.map((_, i) => i).sort((a, b) => weights[b] - weights[a] || a - b);
  let guard = 0;
  while (remaining > 0 && guard < 100000) {
    for (const i of order) {
      if (remaining <= 0) break;
      alloc[i]++;
      remaining--;
    }
    guard++;
  }
  kinds.forEach((k, idx) => {
    for (let n = 0; n < alloc[idx]; n++) items.push({ storyId: null, genre: k.genre, seedIndex: pickSeedIndex(k, n) });
  });
  return items;
}

function findKind(config: ProductionLineConfig, genre: string): ProductionKindTemplate | undefined {
  return config.kinds.find((k) => k.genre === genre);
}

/** 由 产线基线 ⊕ 题材 brief ⊕ 种子 合成单篇创作需求(genre 强制写入) */
export function deriveBriefForItem(config: ProductionLineConfig, item: ProductionRunItem): StoryBrief {
  const kind = findKind(config, item.genre);
  const seed: ProductionKindSeed | undefined =
    kind?.seeds && item.seedIndex !== null ? kind.seeds[item.seedIndex] : undefined;
  const base: StoryBrief = { ...(config.brief ?? {}), ...(kind?.brief ?? {}), genre: item.genre };
  if (seed) {
    if (seed.theme) base.theme = seed.theme;
    if (seed.synopsis) base.synopsis = seed.synopsis;
    if (seed.coreConflict) base.coreConflict = seed.coreConflict;
    if (seed.background) base.background = seed.background;
    if (seed.characters) base.characters = seed.characters;
    if (seed.direction) base.direction = seed.direction;
  }
  if (config.targetWords) base.targetWords = config.targetWords;
  return normalizeBrief(base);
}

function seedTitle(config: ProductionLineConfig, item: ProductionRunItem): string | undefined {
  const kind = findKind(config, item.genre);
  if (kind?.seeds && item.seedIndex !== null) return kind.seeds[item.seedIndex]?.title;
  return undefined;
}

// ---------- 运行执行 ----------

function countTodayForLine(lineId: string, now: Date): number {
  const today = localDateKey(now);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM production_run_items ri
       JOIN production_runs r ON r.id = ri.run_id
       WHERE r.line_id = ? AND r.run_date = ? AND r.status != 'cancelled'`
    )
    .get(lineId, today) as { n: number };
  return row.n;
}

export interface CreateProductionRunInput {
  trigger?: 'manual' | 'daily';
  count?: number;
}

/** 单次运行:确认配额 → 分配题材 → 逐篇建短篇并入队创作流水线 → 落运行记录 */
export function runProductionLine(
  lineId: string,
  input?: CreateProductionRunInput,
  opts?: { now?: Date }
): { run: ProductionRun; createdStoryIds: string[] } {
  const line = getProductionLine(lineId);
  if (!line.enabled) throw new CoreError('INVALID_LINE_CONFIG', '产线当前已停用,无法创建运行');
  const now = opts?.now ?? new Date();
  const today = localDateKey(now);
  // 每日产线同日去重:今天已运行过则拒绝(除非显式手动触发一次)
  if (line.config.schedule.mode === 'daily' && input?.trigger !== 'manual' && line.lastRunDate === today) {
    throw new CoreError('LINE_QUOTA_EXCEEDED', '该每日产线今天已运行过(同日去重)');
  }
  const maxPerRun = line.config.quota?.maxPerRun ?? 50;
  const count = clampInt(num(input?.count) ?? line.config.schedule.count, 1, Math.min(50, maxPerRun), '本次运行篇数');
  // 每日软配额
  const dailyLimit = line.config.quota?.dailyLimit;
  if (dailyLimit !== undefined && countTodayForLine(lineId, now) + count > dailyLimit) {
    throw new CoreError('LINE_QUOTA_EXCEEDED', `当日已创建 ${countTodayForLine(lineId, now)} 篇,超出每日上限 ${dailyLimit}`);
  }
  const db = getDb();
  const nowIso = now.toISOString();
  const runId = genId('pdr');
  const items = assignRunKinds(line.config, count);
  db.prepare(
    "INSERT INTO production_runs (id, line_id, trigger, run_date, count, status, items_json, created_at, executed_at) VALUES (?, ?, ?, ?, ?, 'executing', ?, ?, ?)"
  ).run(runId, lineId, input?.trigger ?? 'manual', today, count, JSON.stringify(items), nowIso, nowIso);
  const created: string[] = [];
  const runItemRows: Array<{ id: string; story_id: string; genre: string; seed_index: number | null }> = [];
  try {
    const itemsWithStory = items.map((it) => {
      const brief = deriveBriefForItem(line.config, it);
      const title = seedTitle(line.config, it);
      const story = createShortStory({ title, brief });
      enqueueCreationPipeline(story.id);
      created.push(story.id);
      runItemRows.push({ id: genId('pdri'), story_id: story.id, genre: it.genre, seed_index: it.seedIndex });
      return { ...it, storyId: story.id };
    });
    const insert = db.prepare(
      'INSERT INTO production_run_items (id, run_id, story_id, genre, seed_index, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const tx = db.transaction(() => {
      for (const r of runItemRows) insert.run(r.id, runId, r.story_id, r.genre, r.seed_index, nowIso);
    });
    tx();
    db.prepare(
      "UPDATE production_runs SET items_json = ?, status = 'done', finished_at = ?, error = NULL WHERE id = ?"
    ).run(JSON.stringify(itemsWithStory), nowIso, runId);
    setLineLastRun(lineId, now);
    return { run: getProductionRun(runId), createdStoryIds: created };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE production_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
      message.slice(0, 4000),
      nowIso,
      runId
    );
    throw err;
  }
}

// ---------- 运行查询 ----------

interface RunRow {
  id: string;
  line_id: string;
  trigger: string;
  run_date: string;
  count: number;
  status: string;
  items_json: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  executed_at: string | null;
}

function toRun(row: RunRow): ProductionRun {
  let items: ProductionRunItem[] = [];
  try {
    items = JSON.parse(row.items_json) as ProductionRunItem[];
  } catch {
    items = [];
  }
  return {
    id: row.id,
    lineId: row.line_id,
    trigger: (row.trigger === 'daily' ? 'daily' : 'manual') as 'manual' | 'daily',
    runDate: row.run_date,
    count: row.count,
    status: (isProductionRunStatus(row.status) ? row.status : 'pending') as ProductionRunStatus,
    items,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    executedAt: row.executed_at,
  };
}

export function getProductionRun(id: string): ProductionRun {
  const row = getDb().prepare('SELECT * FROM production_runs WHERE id = ?').get(id) as RunRow | undefined;
  if (!row) throw new CoreError('PRODUCTION_RUN_NOT_FOUND', `产线运行不存在: ${id}`);
  return toRun(row);
}

export interface ListProductionRunsOptions {
  lineId?: string;
  limit?: number;
}

export function listProductionRuns(opts?: ListProductionRunsOptions): ProductionRun[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.lineId) {
    where.push('line_id = ?');
    params.push(opts.lineId);
  }
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM production_runs ${whereSql} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as RunRow[];
  return rows.map(toRun);
}

// ---------- 每日调度 ----------

/**
 * 调度器扫描:返回本次应触发的每日产线 list。
 * 条件:enabled=1、mode='daily'、今天尚未触发(last_run_date != 今天)、且今天本地时刻已到 hour。
 */
export function listDueDailyProductionLines(now = new Date()): ProductionLine[] {
  const today = localDateKey(now);
  const rows = getDb()
    .prepare('SELECT * FROM production_lines WHERE enabled = 1 ORDER BY created_at ASC, rowid ASC')
    .all() as LineRow[];
  return rows
    .map(toLine)
    .filter((line) => {
      if (line.config.schedule.mode !== 'daily') return false;
      if (line.lastRunDate === today) return false;
      const hour = line.config.schedule.hour ?? 8;
      return now.getHours() >= hour;
    });
}

export function fireDueDailyProductionRuns(now = new Date(), opts?: { onRun?: (r: ProductionRun) => void }): string[] {
  const fired: string[] = [];
  for (const line of listDueDailyProductionLines(now)) {
    try {
      const { run } = runProductionLine(line.id, { trigger: 'daily' }, { now });
      fired.push(run.id);
      opts?.onRun?.(run);
    } catch (err) {
      // 单条产线失败不阻断其他产线;错误在 run 上已可见
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[production] 每日产线 ${line.name} 触发失败:`, message);
    }
  }
  return fired;
}
