// V9 自动评审引擎(规格书 §12/§16/§37):读生效规则+Prompt → 结构化调用 →
// 服务端加权计分定级 → 评审记录全链路落库(快照 rule/prompt/model 版本)
// 总分与等级一律服务端计算,不信任模型自报的 score/level

import { getDb, genId } from './db';
import {
  CoreError,
  levelForScore,
  type DimensionScore,
  type ReviewDimensionSpec,
  type ReviewPrompt,
  type ReviewRecord,
  type ReviewRuleVersion,
  type ShortStory,
  type ShortStoryVersion,
  type StructuredReviewResult,
} from './domain';
import { resolveProviderFromStore } from './settings';
import type { LlmProvider } from './ai-writer';
import { completeStructured } from './structured-output';
import { getActiveRuleVersion } from './review-rule';
import { getReviewPrompt } from './review-prompt';
import { bumpStoryProgress, getShortStory, getStoryVersion } from './short-story';

const FALLBACK_PROMPT_TEMPLATE = `你是资深的短篇小说评审专家。请依据给定的评分维度与评分标准对小说进行严格评审。

评审要求:
1. 逐维度按 0-100 打分,严格对照各维度的评分标准分档。
2. 必须给出每个维度的打分理由(引用文本证据)。
3. strengths/weaknesses/suggestions 各给出 1-5 条,具体可执行,禁止空话。`;

function renderDimensions(dims: ReviewDimensionSpec[]): string {
  return dims
    .map((d, i) => {
      const lines = [
        `${i + 1}. ${d.name}(权重 ${d.weight}%)`,
        `   定义:${d.definition || '(无)'}`,
      ];
      if (d.standards.length > 0) {
        lines.push('   评分标准:');
        for (const s of d.standards) lines.push(`   - ${s.min}-${s.max} 分档:${s.description}`);
      }
      if (d.bonus) lines.push(`   加分条件:${d.bonus}`);
      if (d.penalty) lines.push(`   扣分条件:${d.penalty}`);
      if (d.notes) lines.push(`   评审说明:${d.notes}`);
      return lines.join('\n');
    })
    .join('\n');
}

export interface BuiltReviewPrompt {
  system: string;
  prompt: string;
}

/** 组装评审 Prompt:模板 + 维度标准块 + 小说全文 */
export function buildReviewPrompt(input: {
  template: string;
  dimensions: ReviewDimensionSpec[];
  story: Pick<ShortStory, 'title' | 'sourceUrl'>;
  content: string;
}): BuiltReviewPrompt {
  const prompt = [
    input.template.trim(),
    '',
    '# 评分维度与标准',
    renderDimensions(input.dimensions),
    '',
    '# 待评审小说',
    `标题:《${input.story.title}》`,
    '正文:',
    input.content,
  ].join('\n');
  return {
    system: '你是严格的短篇小说评审专家,只输出符合格式要求的 JSON,不做任何解释。',
    prompt,
  };
}

const SCHEMA_DESCRIPTION = `{
  "dimensions": [{"name": "<必须逐字使用下方给出的维度名>", "score": <0-100 整数>, "reason": "<打分理由,30字以上>"}],
  "strengths": ["优点1", ...],
  "weaknesses": ["问题1", ...],
  "suggestions": ["优化建议1", ...],
  "summary": "<150字以内总评>"
}
dimensions 必须包含且仅包含下方列出的每个维度各一条。`;

interface RawReviewData {
  scores: Array<{ name: string; score: number; reason: string }>;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  summary: string;
}

/** 校验并归一化模型输出的评审数据;不合规 throw Error(message)(供重试反馈) */
function parseReviewData(data: Record<string, unknown>, expectedDims: ReviewDimensionSpec[]): RawReviewData {
  const arr = data.dimensions;
  if (!Array.isArray(arr)) throw new Error('缺少 dimensions 数组');
  const byName = new Map<string, number>();
  for (const raw of arr) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const score = Number(item.score);
    if (!name) continue;
    if (!Number.isFinite(score)) throw new Error(`维度「${name}」的 score 不是数字`);
    byName.set(name, Math.min(100, Math.max(0, Math.round(score))));
    const reason = typeof item.reason === 'string' ? item.reason : '';
    if (!reason.trim()) throw new Error(`维度「${name}」缺少打分理由`);
  }
  const reasons = new Map<string, string>();
  for (const raw of arr) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (name && !reasons.has(name)) reasons.set(name, typeof item.reason === 'string' ? item.reason : '');
  }
  const scores: RawReviewData['scores'] = [];
  const missing: string[] = [];
  for (const dim of expectedDims) {
    const hit = byName.get(dim.name);
    if (hit === undefined) {
      missing.push(dim.name);
      continue;
    }
    scores.push({ name: dim.name, score: hit, reason: reasons.get(dim.name)?.trim() || '(未提供理由)' });
  }
  if (missing.length > 0) throw new Error(`以下维度缺失评分:${missing.join('、')};维度名必须与给定名称逐字一致`);

  const strArr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').slice(0, 10);
    return [];
  };
  return {
    scores,
    strengths: strArr(data.strengths),
    weaknesses: strArr(data.weaknesses),
    suggestions: strArr(data.suggestions),
    summary: typeof data.summary === 'string' ? data.summary.slice(0, 500) : '',
  };
}

/** 加权总分:Σ(维度分 × 权重)/100,四舍五入 */
export function weightedTotal(scores: Array<{ name: string; score: number }>, dims: ReviewDimensionSpec[]): number {
  const weightOf = new Map(dims.map((d) => [d.name, d.weight]));
  let sum = 0;
  for (const s of scores) sum += s.score * (weightOf.get(s.name) ?? 0);
  return Math.round(sum / 100);
}

interface RecordRow {
  id: string;
  story_id: string;
  story_version_id: string;
  source_url: string | null;
  rule_id: string;
  rule_version: string;
  prompt_id: string | null;
  prompt_version: string | null;
  model_id: string | null;
  model_name: string | null;
  model_version: string | null;
  score: number;
  level: string;
  qualified: number;
  dimension_scores_json: string;
  strengths_json: string;
  weaknesses_json: string;
  suggestions_json: string;
  summary: string | null;
  review_round: number;
  optimization_round: number;
  duration_ms: number | null;
  raw_response: string | null;
  structured_result_json: string;
  created_at: string;
}

function jsonArr(text: string): string[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function toRecord(row: RecordRow): ReviewRecord {
  const structured = JSON.parse(row.structured_result_json) as StructuredReviewResult;
  return {
    id: row.id,
    storyId: row.story_id,
    storyVersionId: row.story_version_id,
    sourceUrl: row.source_url,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    promptId: row.prompt_id,
    promptVersion: row.prompt_version,
    modelId: row.model_id,
    modelName: row.model_name,
    modelVersion: row.model_version,
    score: row.score,
    level: row.level as ReviewRecord['level'],
    qualified: row.qualified === 1,
    dimensionScores: JSON.parse(row.dimension_scores_json) as DimensionScore[],
    strengths: jsonArr(row.strengths_json),
    weaknesses: jsonArr(row.weaknesses_json),
    suggestions: jsonArr(row.suggestions_json),
    summary: row.summary,
    reviewRound: row.review_round,
    optimizationRound: row.optimization_round,
    durationMs: row.duration_ms,
    rawResponse: row.raw_response,
    structuredResult: structured,
    createdAt: row.created_at,
  };
}

export interface RunAutoReviewOptions {
  /** 测试注入;缺省从后台设置/环境变量解析 */
  provider?: LlmProvider;
  /** 指定规则版本(回放场景);缺省取当前全局唯一生效版本 */
  ruleVersion?: ReviewRuleVersion;
}

/**
 * 对某个小说版本执行一次自动评审并落库。
 * 记录快照:规则 id+版本号、Prompt id+版本号、模型名、第几次评审、原始响应。
 * 服务端计算总分/等级/是否达标——模型的这些自报字段被丢弃。
 */
export async function runAutoReview(storyVersionId: string, opts?: RunAutoReviewOptions): Promise<ReviewRecord> {
  const version: ShortStoryVersion = getStoryVersion(storyVersionId);
  const story: ShortStory = getShortStory(version.storyId);

  const ruleVersion = opts?.ruleVersion ?? getActiveRuleVersion();
  if (!ruleVersion) {
    throw new CoreError('REVIEW_RULE_NOT_FOUND', '没有已发布的评审规则版本,无法执行自动评审');
  }
  let promptRow: ReviewPrompt | null = null;
  if (ruleVersion.promptId) {
    promptRow = getReviewPrompt(ruleVersion.promptId);
  }
  const built = buildReviewPrompt({
    template: promptRow?.content ?? FALLBACK_PROMPT_TEMPLATE,
    dimensions: ruleVersion.dimensions,
    story,
    content: version.content,
  });

  const provider = opts?.provider ?? (await resolveProviderFromStore());
  const startedAt = Date.now();
  const result = await completeStructured(provider, built, (obj) => parseReviewData(obj, ruleVersion.dimensions));
  const durationMs = Date.now() - startedAt;

  const total = weightedTotal(result.data.scores, ruleVersion.dimensions);
  const level = levelForScore(total);
  const qualified = total >= ruleVersion.qualityThreshold;
  const dimensionScores: DimensionScore[] = result.data.scores.map((s) => ({
    name: s.name,
    score: s.score,
    maxScore: ruleVersion.dimensions.find((d) => d.name === s.name)?.weight ?? 0,
    reason: s.reason,
  }));

  const modelName = provider.name.includes(':') ? provider.name.slice(provider.name.indexOf(':') + 1) : provider.name;
  const now = new Date().toISOString();
  const structured: StructuredReviewResult = {
    score: total,
    level,
    qualified,
    dimensions: dimensionScores,
    strengths: result.data.strengths,
    weaknesses: result.data.weaknesses,
    suggestions: result.data.suggestions,
    summary: result.data.summary,
  };

  const id = genId('rrec');
  getDb()
    .prepare(
      `INSERT INTO review_records
         (id, story_id, story_version_id, source_url, rule_id, rule_version, prompt_id, prompt_version,
          model_id, model_name, model_version, score, level, qualified, dimension_scores_json,
          strengths_json, weaknesses_json, suggestions_json, summary, review_round, optimization_round,
          duration_ms, raw_response, structured_result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      story.id,
      version.id,
      story.sourceUrl,
      ruleVersion.ruleId,
      ruleVersion.version,
      promptRow?.id ?? null,
      promptRow?.version ?? null,
      provider.name,
      modelName,
      total,
      level,
      qualified ? 1 : 0,
      JSON.stringify(dimensionScores),
      JSON.stringify(structured.strengths),
      JSON.stringify(structured.weaknesses),
      JSON.stringify(structured.suggestions),
      structured.summary || null,
      story.reviewRound + 1,
      story.optimizeRound,
      durationMs,
      result.raw,
      JSON.stringify(structured),
      now
    );

  bumpStoryProgress(story.id, { reviewDelta: 1, lastScore: total });
  return getReviewRecord(id);
}

// ---------- 评审记录查询 ----------

export function getReviewRecord(id: string): ReviewRecord {
  const row = getDb().prepare('SELECT * FROM review_records WHERE id = ?').get(id) as RecordRow | undefined;
  if (!row) throw new CoreError('REVIEW_RECORD_NOT_FOUND', `评审记录不存在: ${id}`);
  return toRecord(row);
}

export interface ListReviewRecordsOptions {
  storyId?: string;
  ruleVersion?: string;
  limit?: number;
}

export function listReviewRecords(opts?: ListReviewRecordsOptions): ReviewRecord[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.storyId?.trim()) {
    where.push('story_id = ?');
    params.push(opts.storyId.trim());
  }
  if (opts?.ruleVersion?.trim()) {
    where.push('rule_version = ?');
    params.push(opts.ruleVersion.trim());
  }
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 1000);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM review_records ${whereSql} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as RecordRow[];
  return rows.map(toRecord);
}

/** 某版本的最新一次评审(无则 null);结果页/详情页复用 */
export function latestReviewForVersion(storyVersionId: string): ReviewRecord | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM review_records WHERE story_version_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    )
    .get(storyVersionId) as RecordRow | undefined;
  return row ? toRecord(row) : null;
}
