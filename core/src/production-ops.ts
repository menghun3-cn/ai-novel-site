// V10 内容工厂:运营指挥中心的聚合统计
// 全部面向产线(production_lines)与其运行(production_runs)产出的短篇;
// 依赖 production_run_items 关联表在建表后按 story_id 可聚合,SQLite 轻量聚合,不做逐行扫描。
// 成本为估算:tokens 汇总 × 按机型外推的单价(仅用于运营决策,非账单)。

import { getDb } from './db';
import { getActiveRuleVersion } from './review-rule';
import { backpressureThreshold, countInFlightForLine, listProductionLines, listProductionRuns } from './production-line';
import type { ProductionLine, StoryBrief } from './domain';

function localDateKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- 成本估算 ----------

const MODEL_PRICE_PER_M: Record<string, number> = {
  deepseek: 0.5,
  gpt: 2.5,
  claude: 3.0,
  qwen: 1.0,
  mock: 0,
};

function priceForModel(model: string | null): number {
  if (!model) return 0.5;
  const m = model.toLowerCase();
  for (const [k, v] of Object.entries(MODEL_PRICE_PER_M)) if (m.includes(k)) return v;
  return 0.5;
}

// ---------- 类型 ----------

export interface ProductionOverview {
  kpis: Record<string, number | null>;
  funnel: Array<{ key: string; label: string; count: number; rate: number | null }>;
  lanes: Array<{
    line: ProductionLine;
    total: number;
    inProgress: number;
    passed: number;
    pool: number;
    failed: number;
    published: number;
    todayCreated: number;
    passRate: number | null;
    /** 持续模式:在飞短篇数(背压判定) */
    inFlight?: number;
    /** 持续模式:背压阈值 */
    backpressureThreshold?: number;
  }>;
  alerts: Array<{
    kind: 'failed_task' | 'failed_story' | 'pool' | 'quota' | 'budget' | 'offline_rule' | 'disabled_line' | 'tripped_line';
    severity: 'warning' | 'danger' | 'info';
    lineId?: string;
    lineName?: string;
    title: string;
    detail: string;
    count: number;
  }>;
  recentRuns: ReturnType<typeof listProductionRuns>;
  rule: { active: boolean; threshold: number | null; maxOptimizeRounds: number | null };
  today: string;
}

export interface ProductionQueue {
  byType: Array<{ type: string; pending: number; running: number; success7d: number; failed7d: number; failedCount: number }>;
  running: Array<{ id: string; type: string; refId: string | null; model: string | null; startedAt: string | null; durationMs: number | null }>;
  pausedLines: number;
  totalPending: number;
  totalRunning: number;
  lastProcessedAt: string | null;
}

export interface ProductionGateItem {
  storyId: string;
  title: string;
  status: string;
  genre: string | null;
  lineId: string;
  lineName: string;
  lastScore: number | null;
  optimizeRound: number;
  weaknesses: string[];
  createdAt: string;
}

export interface ProductionGate {
  pool: ProductionGateItem[];
  lines: Array<{
    lineId: string;
    lineName: string;
    reviews: number;
    avgScore: number | null;
    avgOptimizeRound: number | null;
    passRate: number | null;
    threshold: number | null;
    qualifies: boolean;
  }>;
}

export type ExceptionKind = 'failed_task' | 'failed_story' | 'pool_story' | 'quota' | 'budget' | 'offline_rule' | 'disabled_line' | 'tripped_line';

export interface ProductionException {
  kind: ExceptionKind;
  severity: 'warning' | 'danger' | 'info';
  id: string;
  lineId?: string;
  lineName?: string;
  title: string;
  detail: string;
  /** 可执行的修复动作提示(供前端映射为 button) */
  action?: { type: 'retry_task' | 'retry_story' | 'optimize_story' | 'delete_story' | 'enable_line' | 'resume_line' | 'publish' | 'none'; targetId: string };
  createdAt: string | null;
}

export interface ProductionCost {
  byDay: Array<{ date: string; tokens: number; estUsd: number; stories: number; published: number }>;
  byLine: Array<{ lineId: string; lineName: string; tokens: number; estUsd: number; tasks: number; published: number }>;
  totalTokens: number;
  totalEstUsd: number;
  unitCostPerPublished: number | null;
}

// ---------- 关联:story → line/run/genre ----------

interface StoryLineRef {
  storyId: string;
  lineId: string;
  lineName: string;
  genre: string;
  runId: string;
}

function storyLineRefs(limit = 5000): Map<string, StoryLineRef> {
  const rows = getDb()
    .prepare(
      `SELECT ri.story_id, r.line_id, l.name AS line_name, ri.genre, r.id AS run_id
       FROM production_run_items ri
       JOIN production_runs r ON r.id = ri.run_id
       JOIN production_lines l ON l.id = r.line_id
       WHERE ri.story_id IS NOT NULL
       ORDER BY r.created_at DESC, r.rowid DESC
       LIMIT ?`
    )
    .all(limit) as Array<{ story_id: string; line_id: string; line_name: string; genre: string; run_id: string }>;
  const map = new Map<string, StoryLineRef>();
  for (const row of rows) {
    map.set(row.story_id, {
      storyId: row.story_id,
      lineId: row.line_id,
      lineName: row.line_name,
      genre: row.genre,
      runId: row.run_id,
    });
  }
  return map;
}

function gateConfig(line: ProductionLine): { minScore: number | null; reworkMaxRounds: number | null } {
  return {
    minScore: line.config.qualityGate?.minScore ?? null,
    reworkMaxRounds: line.config.qualityGate?.reworkMaxRounds ?? null,
  };
}

// ---------- 产线明细(逐行聚合) ----------

interface LineAgg {
  line_id: string;
  total: number;
  passed: number;
  pool: number;
  in_progress: number;
  failed: number;
  published: number;
}

function lineAggs(): Map<string, LineAgg> {
  const rows = getDb()
    .prepare(
      `SELECT
          r.line_id AS line_id,
          COUNT(ri.id) AS total,
          COALESCE(SUM(CASE WHEN s.status = 'passed' THEN 1 ELSE 0 END), 0) AS passed,
          COALESCE(SUM(CASE WHEN s.status = 'pool' THEN 1 ELSE 0 END), 0) AS pool,
          COALESCE(SUM(CASE WHEN s.status IN ('generating','reviewing','optimizing') THEN 1 ELSE 0 END), 0) AS in_progress,
          COALESCE(SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(CASE WHEN p.story_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS published
       FROM production_run_items ri
       JOIN production_runs r ON r.id = ri.run_id
       LEFT JOIN short_stories s ON s.id = ri.story_id
       LEFT JOIN (SELECT DISTINCT story_id FROM short_story_publications) p ON p.story_id = ri.story_id
       GROUP BY r.line_id`
    )
    .all() as LineAgg[];
  return new Map(rows.map((r) => [r.line_id, r]));
}

function todayCreatedByLine(now = new Date()): Map<string, number> {
  const today = localDateKey(now);
  const rows = getDb()
    .prepare(
      `SELECT r.line_id AS line_id, COUNT(ri.id) AS n
       FROM production_run_items ri JOIN production_runs r ON r.id = ri.run_id
       WHERE r.run_date = ? GROUP BY r.line_id`
    )
    .all(today) as Array<{ line_id: string; n: number }>;
  return new Map(rows.map((r) => [r.line_id, r.n]));
}

// ---------- 总览 ----------

export function getProductionOverview(): ProductionOverview {
  const lines = listProductionLines();
  const aggs = lineAggs();
  const todayMap = todayCreatedByLine();
  const recentRuns = listProductionRuns({ limit: 10 });
  const active = getActiveRuleVersion();

  const lanes: ProductionOverview['lanes'] = lines.map((line) => {
    const a = aggs.get(line.id) ?? { line_id: line.id, total: 0, passed: 0, pool: 0, in_progress: 0, failed: 0, published: 0 };
    const todayCreated = todayMap.get(line.id) ?? 0;
    const passRate = a.total > 0 ? Math.round((a.passed / a.total) * 100) : null;
    const lane: ProductionOverview['lanes'][number] = {
      line,
      total: a.total,
      inProgress: a.in_progress,
      passed: a.passed,
      pool: a.pool,
      failed: a.failed,
      published: a.published,
      todayCreated,
      passRate,
    };
    if (line.config.schedule.mode === 'continuous') {
      lane.inFlight = countInFlightForLine(line.id);
      lane.backpressureThreshold = backpressureThreshold(line.config);
    }
    return lane;
  });

  const total = lanes.reduce((s, l) => s + l.total, 0);
  const passed = lanes.reduce((s, l) => s + l.passed, 0);
  const pool = lanes.reduce((s, l) => s + l.pool, 0);
  const failed = lanes.reduce((s, l) => s + l.failed, 0);
  const inProgress = lanes.reduce((s, l) => s + l.inProgress, 0);
  const published = lanes.reduce((s, l) => s + l.published, 0);
  const todayCreated = lanes.reduce((s, l) => s + l.todayCreated, 0);

  const cost = getProductionCost();
  const kpis: Record<string, number | null> = {
    todayCreated,
    total,
    passed,
    pool,
    failed,
    inProgress,
    published,
    passRate: total > 0 ? Math.round((passed / total) * 100) : null,
    costTodayUsd: cost.byDay.find((d) => d.date === localDateKey(new Date()))?.estUsd ?? 0,
    costTotalUsd: Math.round(cost.totalEstUsd * 100) / 100,
    unitCostPerPublished: cost.unitCostPerPublished,
  };

  const funnelSeed = [
    { key: 'created', label: '注入', count: total },
    { key: 'qualified', label: '达标', count: passed },
    { key: 'published', label: '已发布', count: published },
    { key: 'pool', label: '低质池', count: pool },
    { key: 'failed', label: '失败', count: failed },
  ];
  const funnel = funnelSeed.map((f) => ({
    ...f,
    rate: total > 0 ? Math.round((f.count / total) * 100) : null,
  }));

  const refs = storyLineRefs();
  const alerts = buildAlerts(active, lines, aggs, todayMap, refs, cost);

  return {
    kpis,
    funnel,
    lanes,
    alerts,
    recentRuns,
    rule: {
      active: !!active,
      threshold: active?.qualityThreshold ?? null,
      maxOptimizeRounds: active?.maxAutoOptimizeRounds ?? null,
    },
    today: localDateKey(new Date()),
  };
}

function buildAlerts(
  active: ReturnType<typeof getActiveRuleVersion>,
  lines: ProductionLine[],
  aggs: Map<string, LineAgg>,
  todayMap: Map<string, number>,
  refs: Map<string, StoryLineRef>,
  cost: ProductionCost
): ProductionOverview['alerts'] {
  const alerts: ProductionOverview['alerts'] = [];

  if (!active) {
    alerts.push({
      kind: 'offline_rule',
      severity: 'danger',
      title: '没有生效中的评审规则',
      detail: '产线无法进入自动评审闭环,请在「评审中心」发布一个规则版本。',
      count: 1,
    });
  }

  const failedTasks = getDb()
    .prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE status = 'FAILED' AND type IN ('CREATE_NOVEL','AI_REVIEW','AI_OPTIMIZE_STORY','AI_REVIEW_CHAPTER','AI_OPTIMIZE_CHAPTER','PUBLISH_SHORT_STORY')")
    .get() as { n: number };
  if (failedTasks.n > 0) {
    alerts.push({
      kind: 'failed_task',
      severity: 'danger',
      title: '存在失败任务',
      detail: `${failedTasks.n} 个 AI 任务失败,可在「异常分诊」重试。`,
      count: failedTasks.n,
    });
  }

  const failedStories = getDb().prepare("SELECT COUNT(*) AS n FROM short_stories WHERE status = 'failed'").get() as { n: number };
  if (failedStories.n > 0) {
    alerts.push({
      kind: 'failed_story',
      severity: 'danger',
      title: '存在失败创作',
      detail: `${failedStories.n} 篇短篇创作失败,可在「异常分诊」重试。`,
      count: failedStories.n,
    });
  }

  const poolCount = getDb().prepare("SELECT COUNT(*) AS n FROM short_stories WHERE status = 'pool'").get() as { n: number };
  if (poolCount.n > 0) {
    alerts.push({
      kind: 'pool',
      severity: 'warning',
      title: '低质量内容池有积压',
      detail: `${poolCount.n} 篇未能达标自动入池,可在「质量闸门」查看并处置。`,
      count: poolCount.n,
    });
  }

  for (const line of lines) {
    const dailyLimit = line.config.quota?.dailyLimit;
    if (dailyLimit !== undefined) {
      const today = todayMap.get(line.id) ?? 0;
      if (today >= dailyLimit) {
        alerts.push({
          kind: 'quota',
          severity: 'warning',
          lineId: line.id,
          lineName: line.name,
          title: '产线触发每日配额',
          detail: `「${line.name}」今日已创建 ${today} 篇,达到每日上限 ${dailyLimit}。`,
          count: today,
        });
      }
    }
    const budget = line.config.quota?.dailyBudgetUsd;
    if (budget !== undefined && budget > 0) {
      const lineCost = cost.byLine.find((c) => c.lineId === line.id)?.estUsd ?? 0;
      if (lineCost >= budget) {
        alerts.push({
          kind: 'budget',
          severity: 'warning',
          lineId: line.id,
          lineName: line.name,
          title: '产线成本超预算',
          detail: `「${line.name}」累计成本 $${lineCost.toFixed(2)} 超过每日预算 $${budget.toFixed(2)}。`,
          count: Math.round(lineCost * 100),
        });
      }
    }
  }

  const disabledDaily = lines.filter((l) => !l.enabled && l.config.schedule.mode === 'daily');
  for (const l of disabledDaily) {
    alerts.push({
      kind: 'disabled_line',
      severity: 'info',
      lineId: l.id,
      lineName: l.name,
      title: '产线已停用',
      detail: `「${l.name}」为每日产线但已停用,将不再自动触发。`,
      count: 1,
    });
  }

  // V10.5 持续模式熔断告警:连续失败达阈值自动停线,需人工恢复
  const tripped = lines.filter((l) => l.config.schedule.mode === 'continuous' && l.consecutiveFailures >= l.maxConsecutiveFailures && !!l.trippedAt);
  for (const l of tripped) {
    alerts.push({
      kind: 'tripped_line',
      severity: 'danger',
      lineId: l.id,
      lineName: l.name,
      title: '持续产线已熔断停线',
      detail: `「${l.name}」连续 ${l.consecutiveFailures} 轮失败(阈值 ${l.maxConsecutiveFailures}),已自动停线:${l.trippedReason ?? '未知原因'}`,
      count: l.consecutiveFailures,
    });
  }

  return alerts;
}

// ---------- 队列与吞吐 ----------

export function getProductionQueue(): ProductionQueue {
  const db = getDb();
  const types = ['CREATE_NOVEL', 'AI_REVIEW', 'AI_OPTIMIZE_STORY', 'AI_REVIEW_CHAPTER', 'AI_OPTIMIZE_CHAPTER', 'PUBLISH_SHORT_STORY', 'AI_REVIEW_ARC', 'AI_SUGGEST', 'AI_GENERATE', 'AI_OPTIMIZE'];
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const byType: ProductionQueue['byType'] = types.map((type) => {
    const pending = db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE type = ? AND status = 'PENDING'").get(type) as { n: number };
    const running = db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE type = ? AND status = 'RUNNING'").get(type) as { n: number };
    const success7d = db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE type = ? AND status = 'SUCCESS' AND created_at >= ?").get(type, since7d) as { n: number };
    const failed7d = db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE type = ? AND status = 'FAILED' AND created_at >= ?").get(type, since7d) as { n: number };
    const failedCount = db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE type = ? AND status = 'FAILED'").get(type) as { n: number };
    return { type, pending: pending.n, running: running.n, success7d: success7d.n, failed7d: failed7d.n, failedCount: failedCount.n };
  });

  const running = db
    .prepare(
      "SELECT id, type, ref_id, model_name, started_at, duration_ms FROM ai_tasks WHERE status = 'RUNNING' ORDER BY started_at DESC LIMIT 30"
    )
    .all() as Array<{ id: string; type: string; ref_id: string | null; model_name: string | null; started_at: string | null; duration_ms: number | null }>;

  const totalPending = db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE status = 'PENDING'").get() as { n: number };
  const totalRunning = db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE status = 'RUNNING'").get() as { n: number };
  const pausedLines = db.prepare('SELECT COUNT(*) AS n FROM production_lines WHERE enabled = 0').get() as { n: number };
  const lastProcessed = db.prepare("SELECT MAX(created_at) AS t FROM ai_tasks WHERE status IN ('SUCCESS','FAILED')").get() as { t: string | null };

  return {
    byType,
    running: running.map((r) => ({ id: r.id, type: r.type, refId: r.ref_id, model: r.model_name, startedAt: r.started_at, durationMs: r.duration_ms })),
    pausedLines: pausedLines.n,
    totalPending: totalPending.n,
    totalRunning: totalRunning.n,
    lastProcessedAt: lastProcessed.t,
  };
}

// ---------- 质量闸门 ----------

export function getProductionGate(): ProductionGate {
  const db = getDb();
  const active = getActiveRuleVersion();
  const lines = listProductionLines();
  const refs = storyLineRefs();
  const aggs = lineAggs();

  const poolRows = db
    .prepare(
      `SELECT s.id, s.title, s.status, s.brief_json, s.last_score, s.optimize_round, s.created_at
       FROM short_stories s WHERE s.status = 'pool' ORDER BY s.updated_at DESC LIMIT 50`
    )
    .all() as Array<{ id: string; title: string; status: string; brief_json: string; last_score: number | null; optimize_round: number; created_at: string }>;

  const pool: ProductionGateItem[] = poolRows.map((row) => {
    let brief: StoryBrief = {};
    try {
      brief = JSON.parse(row.brief_json) as StoryBrief;
    } catch {
      brief = {};
    }
    const ref = refs.get(row.id);
    const weaknesses: string[] = [];
    const rec = db
      .prepare('SELECT weaknesses_json FROM review_records WHERE story_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(row.id) as { weaknesses_json: string } | undefined;
    if (rec) {
      let parsed: string[] = [];
      try {
        parsed = JS_weaknesses(rec.weaknesses_json);
      } catch {
        parsed = [];
      }
      weaknesses.push(...parsed);
    }
    return {
      storyId: row.id,
      title: row.title,
      status: row.status,
      genre: brief.genre ?? null,
      lineId: ref?.lineId ?? '',
      lineName: ref?.lineName ?? '—',
      lastScore: row.last_score,
      optimizeRound: row.optimize_round,
      weaknesses,
      createdAt: row.created_at,
    };
  });

  const linesRows = db
    .prepare(
      `SELECT r.line_id AS line_id,
              COUNT(*) AS reviews,
              COALESCE(AVG(rr.score), NULL) AS avg_score,
              COALESCE(AVG(rr.optimization_round), NULL) AS avg_round
       FROM review_records rr
       JOIN production_run_items ri ON ri.story_id = rr.story_id
       JOIN production_runs r ON r.id = ri.run_id
       GROUP BY r.line_id`
    )
    .all() as Array<{ line_id: string; reviews: number; avg_score: number | null; avg_round: number | null }>;
  const aggMap = new Map(linesRows.map((r) => [r.line_id, r]));

  const lineGates = lines.map((line) => {
    const a2 = aggMap.get(line.id);
    const t = gateConfig(line);
    const threshold = t.minScore ?? active?.qualityThreshold ?? 80;
    const avgScore = a2?.avg_score === null || a2?.avg_score === undefined ? null : Math.round(a2.avg_score);
    const a = aggs.get(line.id) ?? { line_id: line.id, total: 0, passed: 0, pool: 0, in_progress: 0, failed: 0, published: 0 };
    const passRate = a.total > 0 ? Math.round((a.passed / a.total) * 100) : null;
    const qualifies = avgScore !== null ? avgScore >= threshold : passRate !== null && passRate >= threshold;
    return {
      lineId: line.id,
      lineName: line.name,
      reviews: a2?.reviews ?? 0,
      avgScore,
      avgOptimizeRound: a2?.avg_round === null || a2?.avg_round === undefined ? null : Math.round(a2.avg_round * 10) / 10,
      passRate,
      threshold,
      qualifies,
    };
  });

  return { pool, lines: lineGates };
}

function JS_weaknesses(json: string): string[] {
  const v = JSON.parse(json) as unknown;
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ---------- 异常分诊 ----------

export function getProductionExceptions(): ProductionException[] {
  const db = getDb();
  const active = getActiveRuleVersion();
  const lines = listProductionLines();
  const refs = storyLineRefs();
  const out: ProductionException[] = [];

  if (!active) {
    out.push({
      kind: 'offline_rule',
      severity: 'danger',
      id: 'offline-rule',
      title: '没有生效中的评审规则',
      detail: '产线无法进入自动评审闭环。',
      action: { type: 'none', targetId: '' },
      createdAt: null,
    });
  }

  const failedTasks = db
    .prepare(
      `SELECT id, type, ref_id, error, created_at FROM ai_tasks
       WHERE status = 'FAILED' AND type IN ('CREATE_NOVEL','AI_REVIEW','AI_OPTIMIZE_STORY','AI_REVIEW_CHAPTER','AI_OPTIMIZE_CHAPTER','PUBLISH_SHORT_STORY')
       ORDER BY created_at DESC LIMIT 40`
    )
    .all() as Array<{ id: string; type: string; ref_id: string | null; error: string | null; created_at: string }>;
  for (const t of failedTasks) {
    const ref = t.ref_id ? refs.get(t.ref_id) : undefined;
    out.push({
      kind: 'failed_task',
      severity: 'danger',
      id: t.id,
      lineId: ref?.lineId,
      lineName: ref?.lineName,
      title: `${taskLabel(t.type)} 失败`,
      detail: t.error ?? '未知错误',
      action: { type: 'retry_task', targetId: t.id },
      createdAt: t.created_at,
    });
  }

  const failedStories = db
    .prepare(
      `SELECT s.id, s.title, s.brief_json, s.last_score FROM short_stories s WHERE s.status = 'failed' ORDER BY s.updated_at DESC LIMIT 40`
    )
    .all() as Array<{ id: string; title: string; brief_json: string; last_score: number | null }>;
  for (const s of failedStories) {
    const ref = refs.get(s.id);
    out.push({
      kind: 'failed_story',
      severity: 'danger',
      id: s.id,
      lineId: ref?.lineId,
      lineName: ref?.lineName,
      title: ref?.genre ? `「${ref.genre}」创作失败` : '短篇创作失败',
      detail: s.title,
      action: { type: 'retry_story', targetId: s.id },
      createdAt: null,
    });
  }

  const poolStories = db
    .prepare("SELECT id, title, last_score FROM short_stories WHERE status = 'pool' ORDER BY updated_at DESC LIMIT 40")
    .all() as Array<{ id: string; title: string; last_score: number | null }>;
  for (const s of poolStories) {
    const ref = refs.get(s.id);
    out.push({
      kind: 'pool_story',
      severity: 'warning',
      id: s.id,
      lineId: ref?.lineId,
      lineName: ref?.lineName,
      title: ref?.genre ? `「${ref.genre}」未达标入池` : '未达标入池',
      detail: `${s.title}${s.last_score !== null ? ` · 最近评分 ${s.last_score}` : ''}`,
      action: { type: 'optimize_story', targetId: s.id },
      createdAt: null,
    });
  }

  const today = localDateKey(new Date());
  for (const line of lines) {
    const dailyLimit = line.config.quota?.dailyLimit;
    if (dailyLimit !== undefined) {
      const todayN = db
        .prepare(
          `SELECT COUNT(*) AS n FROM production_run_items ri
           JOIN production_runs r ON r.id = ri.run_id
           WHERE r.line_id = ? AND r.run_date = ? AND r.status != 'cancelled'`
        )
        .get(line.id, today) as { n: number };
      if (todayN.n >= dailyLimit) {
        out.push({
          kind: 'quota',
          severity: 'warning',
          id: `quota-${line.id}`,
          lineId: line.id,
          lineName: line.name,
          title: '触发每日配额',
          detail: `${todayN.n} / ${dailyLimit}`,
          action: { type: 'none', targetId: line.id },
          createdAt: null,
        });
      }
    }
  }

  for (const line of lines) {
    if (!line.enabled && line.config.schedule.mode === 'daily') {
      out.push({
        kind: 'disabled_line',
        severity: 'info',
        id: `off-${line.id}`,
        lineId: line.id,
        lineName: line.name,
        title: '每日产线已停用',
        detail: '已停用,将不再自动触发。',
        action: { type: 'enable_line', targetId: line.id },
        createdAt: null,
      });
    }
  }

  // V10.5 持续模式熔断:连续失败达阈值自动停线,提供一键恢复
  for (const line of lines) {
    if (line.config.schedule.mode === 'continuous' && line.consecutiveFailures >= line.maxConsecutiveFailures && !!line.trippedAt) {
      out.push({
        kind: 'tripped_line',
        severity: 'danger',
        id: `trip-${line.id}`,
        lineId: line.id,
        lineName: line.name,
        title: '持续产线已熔断停线',
        detail: `连续 ${line.consecutiveFailures} 轮失败(阈值 ${line.maxConsecutiveFailures}):${line.trippedReason ?? '未知原因'}`,
        action: { type: 'resume_line', targetId: line.id },
        createdAt: line.trippedAt,
      });
    }
  }

  return out;
}

function taskLabel(type: string): string {
  const map: Record<string, string> = {
    CREATE_NOVEL: '创作流水线',
    AI_REVIEW: 'AI 评审',
    AI_OPTIMIZE_STORY: 'AI 优化',
    AI_REVIEW_CHAPTER: '章节评审',
    AI_OPTIMIZE_CHAPTER: '章节优化',
    PUBLISH_SHORT_STORY: '发布',
    AI_REVIEW_ARC: '弧级评审',
  };
  return map[type] ?? type;
}

// ---------- 成本 ----------

export function getProductionCost(): ProductionCost {
  const db = getDb();
  const byDayRows = db
    .prepare(
      `SELECT substr(t.created_at, 1, 10) AS day,
              COALESCE(SUM(t.tokens_prompt), 0) + COALESCE(SUM(t.tokens_completion), 0) AS tokens,
              COUNT(*) AS tasks
       FROM ai_tasks t
       WHERE t.ref_id IN (SELECT story_id FROM production_run_items WHERE story_id IS NOT NULL)
       GROUP BY day ORDER BY day DESC LIMIT 30`
    )
    .all() as Array<{ day: string; tokens: number; tasks: number }>;

  const byLineRows = db
    .prepare(
      `SELECT l.id AS line_id, l.name AS line_name,
              COALESCE(SUM(t.tokens_prompt), 0) + COALESCE(SUM(t.tokens_completion), 0) AS tokens,
              COUNT(*) AS tasks
       FROM ai_tasks t
       JOIN production_run_items ri ON ri.story_id = t.ref_id
       JOIN production_runs r ON r.id = ri.run_id
       JOIN production_lines l ON l.id = r.line_id
       WHERE t.ref_id IS NOT NULL
       GROUP BY l.id`
    )
    .all() as Array<{ line_id: string; line_name: string; tokens: number; tasks: number }>;

  const publishedByLine = db
    .prepare(
      `SELECT r.line_id AS line_id, COUNT(DISTINCT p.story_id) AS published
       FROM short_story_publications p
       JOIN production_run_items ri ON ri.story_id = p.story_id
       JOIN production_runs r ON r.id = ri.run_id
       GROUP BY r.line_id`
    )
    .all() as Array<{ line_id: string; published: number }>;
  const pubMap = new Map(publishedByLine.map((r) => [r.line_id, r.published]));

  const publishedByDay = db
    .prepare(
      `SELECT substr(p.published_at, 1, 10) AS day, COUNT(DISTINCT p.story_id) AS n
       FROM short_story_publications p
       JOIN production_run_items ri ON ri.story_id = p.story_id
       GROUP BY day`
    )
    .all() as Array<{ day: string; n: number }>;
  const pubDayMap = new Map(publishedByDay.map((r) => [r.day, r.n]));

  const byDay = byDayRows.map((r) => {
    const rate = priceForModel(null);
    const estUsd = Math.round((r.tokens / 1_000_000) * rate * 100) / 100;
    return { date: r.day, tokens: r.tokens, estUsd, stories: r.tasks, published: pubDayMap.get(r.day) ?? 0 };
  });

  let totalTokens = 0;
  let totalEstUsd = 0;
  let totalPublished = 0;
  const byLine = byLineRows.map((r) => {
    const estUsd = Math.round((r.tokens / 1_000_000) * priceForModel(null) * 100) / 100;
    totalTokens += r.tokens;
    totalEstUsd += estUsd;
    totalPublished += pubMap.get(r.line_id) ?? 0;
    return { lineId: r.line_id, lineName: r.line_name, tokens: r.tokens, estUsd, tasks: r.tasks, published: pubMap.get(r.line_id) ?? 0 };
  });

  return {
    byDay,
    byLine,
    totalTokens,
    totalEstUsd: Math.round(totalEstUsd * 100) / 100,
    unitCostPerPublished: totalPublished > 0 ? Math.round((totalEstUsd / totalPublished) * 10000) / 10000 : null,
  };
}

// ---------- 产线清单(带运行概览,供产线页) ----------

export interface ProductionLineWithMeta extends ProductionLine {
  total: number;
  todayCreated: number;
  passed: number;
  pool: number;
  failed: number;
  published: number;
  passRate: number | null;
  lastRunTitle: string | null;
  lastRunStatus: string | null;
  /** 持续模式:在飞短篇数(背压判定) */
  inFlight?: number;
  /** 持续模式:背压阈值 */
  backpressureThreshold?: number;
}

export function getProductionLinesWithMeta(): ProductionLineWithMeta[] {
  const lines = listProductionLines();
  const aggs = lineAggs();
  const todayMap = todayCreatedByLine();
  return lines.map((line) => {
    const a = aggs.get(line.id) ?? { line_id: line.id, total: 0, passed: 0, pool: 0, in_progress: 0, failed: 0, published: 0 };
    const runs = listProductionRuns({ lineId: line.id, limit: 1 });
    const last = runs[0] ?? null;
    const meta: ProductionLineWithMeta = {
      ...line,
      total: a.total,
      todayCreated: todayMap.get(line.id) ?? 0,
      passed: a.passed,
      pool: a.pool,
      failed: a.failed,
      published: a.published,
      passRate: a.total > 0 ? Math.round((a.passed / a.total) * 100) : null,
      lastRunTitle: last?.error ? last.error : last ? `${last.trigger === 'daily' ? '每日' : last.trigger === 'continuous' ? '持续' : '手动'} · ${last.count} 篇` : null,
      lastRunStatus: last?.status ?? null,
    };
    if (line.config.schedule.mode === 'continuous') {
      meta.inFlight = countInFlightForLine(line.id);
      meta.backpressureThreshold = backpressureThreshold(line.config);
    }
    return meta;
  });
}
