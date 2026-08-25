// V9 阶段二:长篇弧级自动评审(规格书 §10/§37)
// 弧 = 一组连续章节(默认按章节号区间;无 arc 表时退化为 from-to 数字区间)
// 落库:arc_review_records 表(独立表,与 review_records 并行,因实体边界不同)
// 半自动触发:books.last_arc_review_chapter 记录上次弧评覆盖到的章号;
//   当 max(chapter.number) - last_arc_review_chapter >= arc_review_every_n → 触发
//   (但默认 manual 调用 + 调度器扫描;UI 可手选区间)

import { getDb, genId } from './db';
import {
  CoreError,
  levelForScore,
  type DimensionScore,
  type ReviewDimensionSpec,
  type ReviewPrompt,
  type ReviewRuleVersion,
  type StructuredReviewResult,
  type ArcReviewRecord,
} from './domain';
import { resolveProviderFromStore } from './settings';
import type { LlmProvider } from './ai-writer';
import { completeStructured } from './structured-output';
import { getActiveRuleVersion } from './review-rule';
import { getReviewPrompt } from './review-prompt';

const FALLBACK_ARC_PROMPT = `你是严格的长篇小说弧(arc)评审专家。请依据给定的评分维度对一组连续章节构成的故事弧进行严格评审。

评审要求:
1. 逐维度按 0-100 打分,严格对照各维度的评分标准分档。
2. 弧级评审重点:章节间的承接、人物弧线推进、伏笔设置与回收、节奏张力曲线。
3. 必须给出每个维度的打分理由(引用文本证据)。
4. strengths/weaknesses/suggestions 各给出 1-5 条,具体可执行,禁止空话。`;

function renderArcDimensions(dims: ReviewDimensionSpec[]): string {
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

function buildArcPrompt(input: {
  template: string;
  dimensions: ReviewDimensionSpec[];
  bookTitle: string;
  arcLabel: string;
  fromChapter: number;
  toChapter: number;
  concatenated: string;
}): { system: string; prompt: string; schemaDescription: string } {
  const prompt = [
    input.template.trim(),
    '',
    '# 评分维度与标准',
    renderArcDimensions(input.dimensions),
    '',
    '# 待评审弧',
    `所属长篇:《${input.bookTitle}》`,
    `弧标签:${input.arcLabel}`,
    `章节范围:第 ${input.fromChapter} 章 — 第 ${input.toChapter} 章`,
    '弧内文本(已按章拼接,每章前以"==第N章:title=="分隔):',
    input.concatenated,
  ].join('\n');
  return {
    system: '你是严格的长篇小说弧级评审专家,只输出符合格式要求的 JSON,不做任何解释。',
    prompt,
    schemaDescription: SCHEMA_DESCRIPTION,
  };
}

/** 拼接区间章节文本;按章切分(每章 6000 字上限硬控,总长 8000 字) */
function concatenateChapters(
  bookId: string,
  fromChapter: number,
  toChapter: number
): { concatenated: string; chapterCount: number; totalChars: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT number, title, content_md FROM chapters
       WHERE book_id = ? AND status = 'published' AND number BETWEEN ? AND ?
       ORDER BY number ASC`
    )
    .all(bookId, fromChapter, toChapter) as Array<{ number: number; title: string; content_md: string }>;
  if (rows.length === 0) {
    throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `区间 [${fromChapter}, ${toChapter}] 内没有 published 章节`);
  }
  const PER_CHAPTER_LIMIT = 6000;
  const TOTAL_LIMIT = 8000;
  const parts: string[] = [];
  let total = 0;
  for (const r of rows) {
    if (total >= TOTAL_LIMIT) break;
    const remain = TOTAL_LIMIT - total;
    const slice = r.content_md.length > PER_CHAPTER_LIMIT ? r.content_md.slice(0, PER_CHAPTER_LIMIT) + '…(截断)' : r.content_md;
    const line = `==第${r.number}章:${r.title}==\n${slice.length > remain ? slice.slice(0, remain) : slice}`;
    parts.push(line);
    total += line.length;
  }
  return { concatenated: parts.join('\n\n'), chapterCount: rows.length, totalChars: total };
}

export interface RunArcReviewOptions {
  provider?: LlmProvider;
  ruleVersion?: ReviewRuleVersion;
  arcId?: string;
}

export interface RunArcReviewResult extends ArcReviewRecord {
  qualified: boolean;
}

/**
 * 对一段连续章节(弧)执行自动评审,落 arc_review_records。
 * 同步副作用:更新 books.last_arc_review_chapter = max(to_chapter, 原值)。
 * 不自动改 book.status;UI/调度器可据此选择是否进一步动作。
 */
export async function runArcReview(
  bookId: string,
  opts: { arcLabel: string; fromChapter: number; toChapter: number; provider?: LlmProvider; ruleVersion?: ReviewRuleVersion; arcId?: string }
): Promise<RunArcReviewResult> {
  if (opts.fromChapter > opts.toChapter) {
    throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `弧区间非法: ${opts.fromChapter} > ${opts.toChapter}`);
  }
  const bookRow = getDb().prepare('SELECT id, title, arc_review_enabled FROM books WHERE id = ?').get(bookId) as
    | { id: string; title: string; arc_review_enabled: number }
    | undefined;
  if (!bookRow) throw new CoreError('ARC_NOT_FOUND', `书不存在: ${bookId}`);
  if (!bookRow.arc_review_enabled) {
    throw new CoreError('ARC_NOT_FOUND', '该书已禁用弧级评审(arc_review_enabled=0)');
  }
  const { concatenated, chapterCount } = concatenateChapters(bookId, opts.fromChapter, opts.toChapter);

  const ruleVersion = opts.ruleVersion ?? getActiveRuleVersion();
  if (!ruleVersion) {
    throw new CoreError('REVIEW_RULE_NOT_FOUND', '没有已发布的评审规则版本,无法执行弧级评审');
  }
  let promptRow: ReviewPrompt | null = null;
  if (ruleVersion.promptId) promptRow = getReviewPrompt(ruleVersion.promptId);

  const built = buildArcPrompt({
    template: promptRow?.content ?? FALLBACK_ARC_PROMPT,
    dimensions: ruleVersion.dimensions,
    bookTitle: bookRow.title,
    arcLabel: opts.arcLabel,
    fromChapter: opts.fromChapter,
    toChapter: opts.toChapter,
    concatenated,
  });

  const provider = opts.provider ?? (await resolveProviderFromStore());
  const startedAt = Date.now();
  const result = await completeStructured(provider, built, (obj) => parseArcData(obj, ruleVersion.dimensions));
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

  const id = genId('arcrec');
  getDb()
    .prepare(
      `INSERT INTO arc_review_records
         (id, book_id, arc_id, arc_label, from_chapter, to_chapter, rule_id, rule_version, prompt_id, prompt_version,
          model_name, score, level, qualified, dimension_scores_json, strengths_json, weaknesses_json, suggestions_json,
          summary, duration_ms, raw_response, structured_result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      bookId,
      opts.arcId ?? null,
      opts.arcLabel,
      opts.fromChapter,
      opts.toChapter,
      ruleVersion.ruleId,
      ruleVersion.version,
      promptRow?.id ?? null,
      promptRow?.version ?? null,
      modelName,
      total,
      level,
      qualified ? 1 : 0,
      JSON.stringify(dimensionScores),
      JSON.stringify(structured.strengths),
      JSON.stringify(structured.weaknesses),
      JSON.stringify(structured.suggestions),
      structured.summary || null,
      durationMs,
      result.raw,
      JSON.stringify(structured),
      now
    );

  // 更新 last_arc_review_chapter(单调前进)
  getDb()
    .prepare('UPDATE books SET last_arc_review_chapter = MAX(last_arc_review_chapter, ?) WHERE id = ?')
    .run(opts.toChapter, bookId);

  return { ...getArcReviewRecord(id), qualified, ...{ _chapterCount: chapterCount } as { _chapterCount: number } };
}

function weightedTotal(scores: Array<{ name: string; score: number }>, dims: ReviewDimensionSpec[]): number {
  const weightOf = new Map(dims.map((d) => [d.name, d.weight]));
  let sum = 0;
  for (const s of scores) sum += s.score * (weightOf.get(s.name) ?? 0);
  return Math.round(sum / 100);
}

function parseArcData(
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

// ---------- 弧评记录查询 ----------

interface ArcReviewRow {
  id: string;
  book_id: string;
  arc_id: string | null;
  arc_label: string;
  from_chapter: number;
  to_chapter: number;
  rule_id: string;
  rule_version: string;
  prompt_id: string | null;
  prompt_version: string | null;
  model_name: string | null;
  score: number;
  level: string;
  qualified: number;
  dimension_scores_json: string;
  strengths_json: string;
  weaknesses_json: string;
  suggestions_json: string;
  summary: string | null;
  duration_ms: number | null;
  raw_response: string | null;
  structured_result_json: string;
  created_at: string;
}

function toArcRecord(row: ArcReviewRow): ArcReviewRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    arcId: row.arc_id,
    arcLabel: row.arc_label,
    fromChapter: row.from_chapter,
    toChapter: row.to_chapter,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    promptId: row.prompt_id,
    promptVersion: row.prompt_version,
    modelName: row.model_name,
    score: row.score,
    level: row.level as ArcReviewRecord['level'],
    qualified: row.qualified === 1,
    dimensionScores: JSON.parse(row.dimension_scores_json) as DimensionScore[],
    strengths: JSON.parse(row.strengths_json) as string[],
    weaknesses: JSON.parse(row.weaknesses_json) as string[],
    suggestions: JSON.parse(row.suggestions_json) as string[],
    summary: row.summary,
    durationMs: row.duration_ms,
    rawResponse: row.raw_response,
    structuredResult: JSON.parse(row.structured_result_json) as StructuredReviewResult,
    createdAt: row.created_at,
  };
}

export function getArcReviewRecord(id: string): ArcReviewRecord {
  const row = getDb().prepare('SELECT * FROM arc_review_records WHERE id = ?').get(id) as ArcReviewRow | undefined;
  if (!row) throw new CoreError('ARC_REVIEW_RECORD_NOT_FOUND', `弧评记录不存在: ${id}`);
  return toArcRecord(row);
}

export function listArcReviewRecords(bookId: string, opts?: { limit?: number }): ArcReviewRecord[] {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const rows = getDb()
    .prepare('SELECT * FROM arc_review_records WHERE book_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(bookId, limit) as ArcReviewRow[];
  return rows.map(toArcRecord);
}

// ---------- 半自动判定 ----------

/** 该书是否应触发半自动弧评(新增章数达阈值且功能开启) */
export function shouldTriggerAutoArcReview(bookId: string): { should: boolean; fromChapter: number; toChapter: number; reason: string } {
  const book = getDb()
    .prepare(
      `SELECT id, arc_review_every_n, arc_review_enabled, last_arc_review_chapter FROM books WHERE id = ?`
    )
    .get(bookId) as
    | { id: string; arc_review_every_n: number; arc_review_enabled: number; last_arc_review_chapter: number }
    | undefined;
  if (!book) return { should: false, fromChapter: 0, toChapter: 0, reason: 'book 不存在' };
  if (!book.arc_review_enabled) return { should: false, fromChapter: 0, toChapter: 0, reason: 'arc_review_enabled=0' };
  if (book.arc_review_every_n <= 0) return { should: false, fromChapter: 0, toChapter: 0, reason: 'arc_review_every_n=0(禁用自动弧评)' };
  const maxRow = getDb()
    .prepare(`SELECT MAX(number) AS m FROM chapters WHERE book_id = ? AND status = 'published'`)
    .get(bookId) as { m: number | null };
  const maxChapter = maxRow.m ?? 0;
  if (maxChapter === 0) return { should: false, fromChapter: 0, toChapter: 0, reason: '尚无 published 章节' };
  const fromChapter = book.last_arc_review_chapter + 1;
  if (maxChapter - book.last_arc_review_chapter < book.arc_review_every_n) {
    return { should: false, fromChapter, toChapter: maxChapter, reason: `新增章数 ${maxChapter - book.last_arc_review_chapter} < 阈值 ${book.arc_review_every_n}` };
  }
  return { should: true, fromChapter, toChapter: maxChapter, reason: '达到阈值' };
}
