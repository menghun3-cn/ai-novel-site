// V9.5 阶段二补丁:长篇单章自动优化引擎
// 模式与短篇 optimize-engine 镜像;不重写到另一篇 — 保留原章节人设/情节脉络,只解决评审问题清单
// 与 review-engine 协作:runChapterReview 不达标时入队 AI_OPTIMIZE_CHAPTER → 本引擎执行 → 重新评审
// 轮数受 books.chapter_review_max_rounds 约束(默认 1),由 executeAiTask 在分发时检查

import { getDb } from './db';
import { CoreError, type ReviewRecord } from './domain';
import type { LlmProvider } from './ai-writer';
import { resolveProviderFromStore } from './settings';

const OPTIMIZE_SYSTEM =
  '你是资深的长篇小说章节改稿编辑。严格在原作基础上做针对性修订,保留人物、情节脉络、本章在整书中的承接定位;直接输出修订后的完整正文(Markdown),不要任何解释或标题。';

export interface BuiltChapterOptimizePrompt {
  prompt: string;
}

export function buildChapterOptimizePrompt(input: {
  bookTitle: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterContent: string;
  record: ReviewRecord;
}): BuiltChapterOptimizePrompt {
  const lowDims = input.record.dimensionScores
    .slice()
    .sort((a, b) => a.score / Math.max(a.maxScore, 1) - b.score / Math.max(b.maxScore, 1))
    .map((d) => `- ${d.name}(本次 ${d.score}/${d.maxScore}):${d.reason}`);
  const parts: string[] = [
    `请针对评审发现的问题修订以下长篇章节《${input.bookTitle}》第 ${input.chapterNumber} 章「${input.chapterTitle}」。`,
    '',
    '# 修订硬约束',
    '- 保留本章的人物设定、情节脉络、与前后章的承接关系;不得重写成另一篇章节。',
    '- 只针对下方问题清单做修改;没有涉及的部分尽量保持原文。',
    '- 输出修订后的完整正文(从开头到结尾),不要输出修改说明或对比。',
    '',
    '# 本次评审发现的问题(逐条解决)',
    ...input.record.weaknesses.map((w) => `- 问题:${w}`),
    ...input.record.suggestions.map((s) => `- 建议:${s}`),
    ...(lowDims.length > 0 ? ['', '# 薄弱维度及理由'] : []),
    ...lowDims,
    '',
    '# 原文(第 ' + input.chapterNumber + ' 章)',
    input.chapterContent,
  ];
  return { prompt: parts.join('\n') };
}

export interface RunChapterOptimizationOptions {
  provider?: LlmProvider;
}

export interface ChapterOptimizationResult {
  chapterId: string;
  newContentMd: string;
  newOptimizeRound: number;
  charCount: number;
}

/**
 * 对已评审的 published 章节执行一次 LLM 改写并 UPDATE chapters.content_md。
 * optimize_round += 1;新内容 in-place 落库(无版本表,沿用 v1 简化设计)。
 * 返回新 optimizeRound 供调用方判断是否还要继续(本函数本身不判断轮数上限,留给 task 分发器)。
 */
export async function runChapterOptimization(
  chapterId: string,
  record: ReviewRecord,
  opts?: RunChapterOptimizationOptions
): Promise<ChapterOptimizationResult> {
  if (record.chapterId !== chapterId) {
    throw new CoreError('INVALID_INPUT', `评审记录 ${record.id} 不属于章节 ${chapterId}`);
  }
  const db = getDb();
  const row = db
    .prepare(
      `SELECT c.id, c.book_id, c.number, c.title, c.content_md, c.status, c.optimize_round,
              b.title AS book_title, b.chapter_review_max_rounds
       FROM chapters c JOIN books b ON b.id = c.book_id
       WHERE c.id = ?`
    )
    .get(chapterId) as
    | {
        id: string;
        book_id: string;
        number: number;
        title: string;
        content_md: string;
        status: string;
        optimize_round: number;
        book_title: string;
        chapter_review_max_rounds: number;
      }
    | undefined;
  if (!row) throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `章节不存在: ${chapterId}`);
  if (row.status !== 'published') {
    throw new CoreError('CHAPTER_NOT_FOUND_IN_ARC', `仅已发布章节可优化,当前 status=${row.status}`);
  }
  if (row.optimize_round >= row.chapter_review_max_rounds) {
    throw new CoreError(
      'INVALID_INPUT',
      `已达优化轮数上限(max_rounds=${row.chapter_review_max_rounds});需在管理后台手动处理`
    );
  }

  const built = buildChapterOptimizePrompt({
    bookTitle: row.book_title,
    chapterNumber: row.number,
    chapterTitle: row.title,
    chapterContent: row.content_md,
    record,
  });

  const provider = opts?.provider ?? (await resolveProviderFromStore());
  const raw = await provider.complete({
    system: OPTIMIZE_SYSTEM,
    prompt: built.prompt,
    maxTokens: 8000,
    temperature: 0.7,
  });
  const content = stripLeadingHeading(raw);
  if (!content || content.length < 50) {
    throw new Error('章节优化输出过短,疑似未按完整正文返回');
  }

  const at = new Date().toISOString();
  const newRound = row.optimize_round + 1;
  db.prepare('UPDATE chapters SET content_md = ?, optimize_round = ?, updated_at = ? WHERE id = ?').run(
    content,
    newRound,
    at,
    chapterId
  );

  return { chapterId, newContentMd: content, newOptimizeRound: newRound, charCount: content.length };
}

/** 剥掉模型可能输出的首个标题行 */
function stripLeadingHeading(text: string): string {
  return text.replace(/^#\s+.+\n+/, '').trim();
}
