// V9 阶段二:长篇单章自动评审(规格书 §10/§37)
// 复用 review-engine 的"读规则+Prompt → 结构化调用 → 服务端加权定级 → 落库快照"范式
// 落库表复用 review_records(新增 ref_type='chapter' + chapter_id 列);story_id/version_id 写 NULL
// 章节优化走现有 chapter_update 流程(optimize-engine 暂不重做,本里程碑只做评审)

import { getDb, genId } from './db';
import {
  CoreError,
  levelForScore,
  type DimensionScore,
  type ReviewDimensionSpec,
  type ReviewPrompt,
  type ReviewRecord,
  type ReviewRuleVersion,
  type StructuredReviewResult,
} from './domain';
import { resolveProviderFromStore } from './settings';
import type { LlmProvider } from './ai-writer';
import { completeStructured } from './structured-output';
import { getActiveRuleVersion } from './review-rule';
import { getReviewPrompt } from './review-prompt';
import { getReviewRecord } from './review-engine';
import { getBookById, getChapterByNumber } from './service';

const FALLBACK_CHAPTER_PROMPT = `你是严格的长篇小说章节评审专家。请依据给定的评分维度对单个章节进行严格评审。

评审要求:
1. 逐维度按 0-100 打分,严格对照各维度的评分标准分档。
2. 必须给出每个维度的打分理由(引用文本证据)。
3. 章节定位:本章节在所属长篇中的独立性(承接上文、推进剧情或人物)需作为「情节与冲突」重点考量。
4. strengths/weaknesses/suggestions 各给出 1-5 条,具体可执行,禁止空话。`;

function renderChapterDimensions(dims: ReviewDimensionSpec[]): string {
  return dims
    .map((d, i) => {
      const lines = [`${i + 1}. ${d.name}(权重 ${d.weight}%)`, `   定义:${d.definition || '(无)'}`];
      if (d.standards.length > 0) {
        lines.push('   评分标准:');
        for (const s of d.standards) lines.push(`   - ${s.min}-${s.max} 分档:${s.description}`);
      }
      if (d.notes) lines.push(`   评审说明:${d.notes}`);
      return lines.join('\n');
    })
    .join('\n');
}

const SCHEMA_DESCRIPTION = `{
  "dimensions": [{"name": "<必须逐字使用下方给出的维度名>", "score": <0-100 整数>, "reason": "<打分理由,30字以上>"}],
  "strengths": ["优点1", ...],
  "weaknesses": ["问题1", ...],
  "suggestions": ["优化建议1", ...],
  "summary": "<200字以内总评>"
}
dimensions 必须包含且仅包含下方列出的每个维度各一条。`;

function buildChapterPrompt(input: {
  template: string;
  dimensions: ReviewDimensionSpec[];
  bookTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  content: string;
}): { system: string; prompt: string; schemaDescription: string } {
  const prompt = [
    input.template.trim(),
    '',
    '# 评分维度与标准',
    renderChapterDimensions(input.dimensions),
    '',
    '# 待评审章节',
    `所属长篇:《${input.bookTitle}》`,
    `章号:第 ${input.chapterNumber} 章`,
    `章节标题:${input.chapterTitle}`,
    '正文:',
    input.content,
  ].join('\n');
  return {
    system: '你是严格的长篇小说章节评审专家,只输出符合格式要求的 JSON,不做任何解释。',
    prompt,
    schemaDescription: SCHEMA_DESCRIPTION,
  };
}

export interface RunChapterReviewOptions {
  provider?: LlmProvider;
  ruleVersion?: ReviewRuleVersion;
}

/**
 * 对一个 published 章节执行自动评审并落 review_records(ref_type='chapter')。
 * 触发入口:连载流水线 publishChapter 后(若 books.chapter_review_enabled=1)。
 * 不合格不自动优化(由调用方决定 enqueue optimization),仅返回 ReviewRecord 与是否合格。
 */
export async function runChapterReview(
  chapterId: string,
  opts?: RunChapterReviewOptions
): Promise<ReviewRecord & { qualified: boolean }> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT c.id, c.book_id, c.number, c.title, c.content_md, c.status, b.title AS book_title
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`
    )
    .get(chapterId) as
    | { id: string; book_id: string; number: number; title: string; content_md: string; status: string; book_title: string }
    | undefined;
  if (!row) throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `章节不存在: ${chapterId}`);
  if (row.status !== 'published') {
    // 只评审已发布章节(草稿/审核中不放进评审流,避免重复)
    throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `章节未发布,无法评审(status=${row.status})`);
  }

  const ruleVersion = opts?.ruleVersion ?? getActiveRuleVersion();
  if (!ruleVersion) {
    throw new CoreError('REVIEW_RULE_NOT_FOUND', '没有已发布的评审规则版本,无法执行章节评审');
  }
  let promptRow: ReviewPrompt | null = null;
  if (ruleVersion.promptId) promptRow = getReviewPrompt(ruleVersion.promptId);

  const built = buildChapterPrompt({
    template: promptRow?.content ?? FALLBACK_CHAPTER_PROMPT,
    dimensions: ruleVersion.dimensions,
    bookTitle: row.book_title,
    chapterNumber: row.number,
    chapterTitle: row.title,
    content: row.content_md,
  });

  const provider = opts?.provider ?? (await resolveProviderFromStore());
  const startedAt = Date.now();
  const result = await completeStructured(provider, built, (obj) => parseChapterData(obj, ruleVersion.dimensions));
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
  db.prepare(
    `INSERT INTO review_records
       (id, story_id, story_version_id, source_url, rule_id, rule_version, prompt_id, prompt_version,
        model_id, model_name, model_version, score, level, qualified, dimension_scores_json,
        strengths_json, weaknesses_json, suggestions_json, summary, review_round, optimization_round,
        duration_ms, raw_response, structured_result_json, created_at, chapter_id, ref_type)
     VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'chapter')`
  ).run(
    id,
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
    1,
    0,
    durationMs,
    result.raw,
    JSON.stringify(structured),
    now,
    chapterId
  );

  const rec = getReviewRecord(id);
  return { ...rec, qualified };
}

function weightedTotal(scores: Array<{ name: string; score: number }>, dims: ReviewDimensionSpec[]): number {
  const weightOf = new Map(dims.map((d) => [d.name, d.weight]));
  let sum = 0;
  for (const s of scores) sum += s.score * (weightOf.get(s.name) ?? 0);
  return Math.round(sum / 100);
}

function parseChapterData(
  data: Record<string, unknown>,
  expectedDims: ReviewDimensionSpec[]
): { scores: Array<{ name: string; score: number; reason: string }>; strengths: string[]; weaknesses: string[]; suggestions: string[]; summary: string } {
  const arr = data.dimensions;
  if (!Array.isArray(arr)) throw new Error('缺少 dimensions 数组');
  const byName = new Map<string, { score: number; reason: string }>();
  for (const raw of arr) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const score = Number(item.score);
    if (!name || !Number.isFinite(score)) continue;
    byName.set(name, { score: Math.min(100, Math.max(0, Math.round(score))), reason: typeof item.reason === 'string' ? item.reason : '' });
  }
  const scores: Array<{ name: string; score: number; reason: string }> = [];
  const missing: string[] = [];
  for (const dim of expectedDims) {
    const hit = byName.get(dim.name);
    if (!hit) {
      missing.push(dim.name);
      continue;
    }
    scores.push({ name: dim.name, score: hit.score, reason: hit.reason.trim() || '(未提供理由)' });
  }
  if (missing.length > 0) throw new Error(`以下维度缺失评分:${missing.join('、')}`);
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
  return {
    scores,
    strengths: strArr(data.strengths),
    weaknesses: strArr(data.weaknesses),
    suggestions: strArr(data.suggestions),
    summary: typeof data.summary === 'string' ? data.summary.slice(0, 500) : '',
  };
}

// ---------- 查询(章节维度) ----------

export function listChapterReviews(chapterId: string): ReviewRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM review_records
       WHERE chapter_id = ? AND ref_type = 'chapter'
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(chapterId) as Array<Record<string, unknown>>;
  return rows.map((r) => toRecordFromAnyRow(r));
}

export function latestChapterReview(chapterId: string): ReviewRecord | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM review_records
       WHERE chapter_id = ? AND ref_type = 'chapter'
       ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(chapterId) as Record<string, unknown> | undefined;
  return row ? toRecordFromAnyRow(row) : null;
}

// ---------- 工具 ----------

/** 短篇/章节/弧通用 record 反射读列(duck-typed,避免重复实现) */
function toRecordFromAnyRow(row: Record<string, unknown>): ReviewRecord {
  const get = <T>(k: string, def: T): T => (row[k] === undefined || row[k] === null ? def : (row[k] as T));
  return {
    id: get<string>('id', ''),
    storyId: get<string | null>('story_id', null),
    storyVersionId: get<string | null>('story_version_id', null),
    sourceUrl: get<string | null>('source_url', null),
    ruleId: get<string>('rule_id', ''),
    ruleVersion: get<string>('rule_version', ''),
    promptId: get<string | null>('prompt_id', null),
    promptVersion: get<string | null>('prompt_version', null),
    modelId: get<string | null>('model_id', null),
    modelName: get<string | null>('model_name', null),
    modelVersion: get<string | null>('model_version', null),
    score: get<number>('score', 0),
    level: get<string>('level', 'D') as ReviewRecord['level'],
    qualified: get<number>('qualified', 0) === 1,
    dimensionScores: JSON.parse(get<string>('dimension_scores_json', '[]')) as DimensionScore[],
    strengths: JSON.parse(get<string>('strengths_json', '[]')) as string[],
    weaknesses: JSON.parse(get<string>('weaknesses_json', '[]')) as string[],
    suggestions: JSON.parse(get<string>('suggestions_json', '[]')) as string[],
    summary: get<string | null>('summary', null),
    reviewRound: get<number>('review_round', 1),
    optimizationRound: get<number>('optimization_round', 0),
    durationMs: get<number | null>('duration_ms', null),
    rawResponse: get<string | null>('raw_response', null),
    structuredResult: JSON.parse(get<string>('structured_result_json', '{}')) as StructuredReviewResult,
    createdAt: get<string>('created_at', ''),
  };
}

// 复用 review-engine 的 getReviewRecord(ref_type 无关,任何记录都查)
export { getReviewRecord };

void getBookById;
void getChapterByNumber;
