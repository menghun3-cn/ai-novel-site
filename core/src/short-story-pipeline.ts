// V9 创作流水线(规格书 §9/§19-§22):整篇生成 → 自动评审 → 不达标自动优化 → 再评审
// 循环受规则版本 max_auto_optimize_rounds 约束,永不无限循环;
// 每步状态回写 short_stories.status 供前端轮询;全部动作落 ai_tasks 留痕。

import {
  CoreError,
  type AiTask,
  type StoryBrief,
} from './domain';
import { SHORT_STORY_FIELD_LABELS } from './domain';
import type { LlmProvider } from './ai-writer';
import { qualityCheckChapter } from './ai-writer';
import { resolveProviderFromStore } from './settings';
import {
  claimPendingTasks,
  completeAiTask,
  createAiTask,
  failAiTask,
  getAiTask,
  startAiTask,
} from './ai-task';
import { getActiveRuleVersion } from './review-rule';
import { getDb } from './db';
import { getReviewRecord, latestReviewForVersion, runAutoReview } from './review-engine';
import { runOptimization } from './optimize-engine';
import { executeAssistTask, type AssistTaskInput } from './ai-assist';
import { runChapterReview } from './chapter-review';
import { runArcReview } from './arc-review';
import { runChapterOptimization } from './chapter-optimize';
import {
  appendVersion,
  getShortStory,
  setFinalVersion,
  transitionStory,
  tryGetShortStory,
  updateShortStory,
} from './short-story';

/** 单次成文硬上限(单次 LLM 调用 maxTokens≈8000 ≈ 5000-6000 汉字;决策点 #3 已确认) */
const MAX_TARGET_WORDS = 6000;

// ---------- 整篇生成 ----------

function briefLines(brief: StoryBrief | undefined): string[] {
  if (!brief) return [];
  return Object.entries(brief)
    .filter(([k, v]) => k !== 'targetWords' && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `- ${SHORT_STORY_FIELD_LABELS[k] ?? k}:${String(v)}`);
}

export function buildCreationPrompt(brief: StoryBrief | undefined): string {
  const target = Math.min(Math.max(Math.round(brief?.targetWords ?? 3000), 500), MAX_TARGET_WORDS);
  const parts = [
    '请根据以下创作要求写一篇完整的短篇小说。',
    '',
    '# 输出格式(硬性)',
    '- 第一行必须是 Markdown 一级标题,例如 `# 雨夜重逢`(用一句话凝练的故事标题,中文,≤25 字)。',
    '- 第二行起为故事正文(直到结束)。',
    '- 正文不要再次出现标题行,不要输出任何创作说明、解释或前后记。',
    '',
    '# 创作要求',
    ...(briefLines(brief).length > 0 ? briefLines(brief) : ['- 主题与题材不限,自由发挥一篇有完整故事性的短篇。']),
    '',
    '# 硬性要求',
    `- 正文篇幅约 ${target} 字(允许上下浮动 10%,不要超过 ${MAX_TARGET_WORDS} 字)。`,
    '- 故事必须包含明确的开端、冲突、发展、高潮与结局,前后呼应。',
  ];
  return parts.join('\n');
}

const CREATION_SYSTEM =
  '你是资深短篇小说作者。严格遵循用户消息中的创作要求写作;首行输出一个简练的故事标题(中文,≤25 字,Markdown 一级标题格式),从第二行起输出完整正文;不要输出任何解释、创作说明或前后记。';

/** 流水线结果摘要(任务 output 用) */
export interface PipelineOutcome {
  status: 'passed' | 'pool';
  finalVersionId: string;
  score: number;
  /** 本次运行的自动优化次数 */
  autoOptimizeRounds: number;
}

/**
 * 完整创作闭环。仅 draft/failed 状态可启动;中途任何一步抛错都由调用方
 * (processAiTasks)记录到任务并置小说为 failed。
 */
export async function runCreationPipeline(
  storyId: string,
  opts?: { provider?: LlmProvider }
): Promise<PipelineOutcome> {
  const story = getShortStory(storyId);
  // generating 由调度器 fireScheduledStory 后立即入队的任务进入;passed/pool 终态拒绝
  if (story.status === 'passed' || story.status === 'pool') {
    throw new CoreError('INVALID_INPUT', `当前状态 ${story.status} 不允许启动创作流水线(已终态)`);
  }
  const ruleVersion = getActiveRuleVersion();
  if (!ruleVersion) {
    throw new CoreError('REVIEW_RULE_NOT_FOUND', '没有已发布的评审规则版本,无法启动自动评审闭环');
  }
  // 先进入 generating:此后任何一步(含 Provider 解析)失败都会被置为 failed,错误可见
  transitionStory(storyId, 'generating');
  const provider = opts?.provider ?? (await resolveProviderFromStore());

  // 阶段一:整篇生成
  const prompt = buildCreationPrompt(story.brief);
  const raw = await provider.complete({
    system: CREATION_SYSTEM,
    prompt,
    maxTokens: 8000,
    temperature: 0.85,
  });
  // 首行 `# 标题` 抽离作为作品名(仅在用户未填时采用);正文从第二行起
  const titleMatch = raw.match(/^#\s+([^\n]+?)\s*\n+/);
  const generatedTitle = titleMatch?.[1]?.trim() ?? '';
  const content = raw.replace(/^#\s+.+\n+/, '').trim();
  const quality = qualityCheckChapter(content, { minChars: 500 });
  if (!quality.ok) {
    throw new CoreError(
      'AI_PROVIDER_FAILED',
      `生成内容未通过基础质检:${quality.issues.map((i) => i.detail).join(';')}`
    );
  }
  // 仅在用户未填名称(默认占位)时,采用 LLM 出的标题
  if (generatedTitle && (!story.title || story.title === '未命名短篇')) {
    updateShortStory(storyId, { title: generatedTitle });
  }
  let current = appendVersion(storyId, {
    content,
    creationReason: 'generated',
    generationPrompt: prompt,
    modelName: provider.name,
  });

  // 阶段二:评审 → 优化 → 再评审
  let autoRounds = 0;
  for (;;) {
    transitionStory(storyId, 'reviewing');
    const record = await runAutoReview(current.id, { provider, ruleVersion });
    if (record.qualified) {
      setFinalVersion(storyId, current.id);
      transitionStory(storyId, 'passed');
      // 通过即自动入队发布任务(passed=可发布);失败可由任务系统重试
      enqueuePublishShortStory(storyId);
      return { status: 'passed', finalVersionId: current.id, score: record.score, autoOptimizeRounds: autoRounds };
    }
    if (autoRounds >= ruleVersion.maxAutoOptimizeRounds) {
      // 达到最大优化次数仍未达标 → 低质量内容池(规格书 §22),不自动发布
      transitionStory(storyId, 'pool');
      return { status: 'pool', finalVersionId: current.id, score: record.score, autoOptimizeRounds: autoRounds };
    }
    transitionStory(storyId, 'optimizing');
    const optimized = await runOptimization(current.id, record, { provider });
    autoRounds++;
    current = optimized.version;
  }
}

// ---------- 任务入队 ----------

/** 启动创作流水线(draft/failed/scheduled 可入队;generating 由调度器 fireScheduledStory 后入队) */
export function enqueueCreationPipeline(storyId: string): AiTask {
  const story = getShortStory(storyId);
  if (story.status === 'passed' || story.status === 'pool') {
    throw new CoreError('INVALID_INPUT', `当前状态 ${story.status} 不允许入队创作(已终态)`);
  }
  return createAiTask({ type: 'CREATE_NOVEL', refType: 'short_story', refId: storyId });
}

const ASSIST_ACTION_TYPE = {
  suggest: 'AI_SUGGEST',
  generate: 'AI_GENERATE',
  optimize: 'AI_OPTIMIZE',
} as const;

/** 字段辅助入队 */
export function enqueueAssistTask(input: AssistTaskInput): AiTask {
  return createAiTask({
    type: ASSIST_ACTION_TYPE[input.action],
    refType: 'field_assist',
    input: input as unknown as Record<string, unknown>,
  });
}

/** 手动重新评审当前版本入队 */
export function enqueueManualReview(storyId: string): AiTask {
  getShortStory(storyId);
  return createAiTask({ type: 'AI_REVIEW', refType: 'short_story', refId: storyId });
}

/** 手动优化当前最终版入队(不受自动轮数上限约束,独立计数) */
export function enqueueManualOptimize(storyId: string): AiTask {
  const story = getShortStory(storyId);
  if (!story.currentVersionId) throw new CoreError('INVALID_INPUT', '该小说尚无版本,无法优化');
  const lastRecord = latestReviewForVersion(story.currentVersionId);
  if (!lastRecord) {
    throw new CoreError('INVALID_INPUT', '当前版本尚未评审,请先执行评审再优化');
  }
  return createAiTask({
    type: 'AI_OPTIMIZE_STORY',
    refType: 'short_story',
    refId: storyId,
    input: { reviewRecordId: lastRecord.id },
  });
}

/**
 * V9 阶段二:章节评审入队 — 调度器/管理后台通用入口
 * refId = chapterId,refType = 'chapter',被 processAiTasks 拾取后调 runChapterReview
 */
export function enqueueChapterReview(chapterId: string): AiTask {
  return createAiTask({ type: 'AI_REVIEW_CHAPTER', refType: 'chapter', refId: chapterId });
}

/**
 * V9.5 阶段二补丁:章节优化入队 — 由 AI_REVIEW_CHAPTER 不合格时自动触发,也可手动调用
 * reviewRecordId 存入 task.input;执行时读该记录的 weaknesses/suggestions 作为改写指引
 */
export function enqueueChapterOptimization(chapterId: string, reviewRecordId: string): AiTask {
  return createAiTask({
    type: 'AI_OPTIMIZE_CHAPTER',
    refType: 'chapter',
    refId: chapterId,
    input: { reviewRecordId },
  });
}

/**
 * V9 阶段二:弧级评审入队 — 调度器/管理后台通用入口
 * 区间与弧标签存在 task.input 中(因为 refId 只能单值)
 */
export function enqueueArcReview(input: {
  bookId: string;
  arcLabel: string;
  fromChapter: number;
  toChapter: number;
}): AiTask {
  return createAiTask({
    type: 'AI_REVIEW_ARC',
    refType: 'book',
    refId: input.bookId,
    input: { bookId: input.bookId, arcLabel: input.arcLabel, fromChapter: input.fromChapter, toChapter: input.toChapter },
  });
}

/**
 * V9 阶段二:短篇发布入队(异步执行 publishShortStory,失败可由任务系统重试)
 */
export function enqueuePublishShortStory(storyId: string): AiTask {
  return createAiTask({ type: 'PUBLISH_SHORT_STORY', refType: 'short_story', refId: storyId });
}

// ---------- 任务分发与循环处理 ----------

export interface ExecuteTaskOptions {
  provider?: LlmProvider;
}

/** 单个任务的执行分派;抛错由 processAiTasks 记录为 FAILED */
export async function executeAiTask(task: AiTask, opts?: ExecuteTaskOptions): Promise<Record<string, unknown>> {
  switch (task.type) {
    case 'CREATE_NOVEL': {
      if (!task.refId) throw new CoreError('INVALID_INPUT', 'CREATE_NOVEL 任务缺少 refId');
      return (await runCreationPipeline(task.refId, opts)) as unknown as Record<string, unknown>;
    }
    case 'AI_SUGGEST':
    case 'AI_GENERATE':
    case 'AI_OPTIMIZE': {
      return await executeAssistTask(task, opts);
    }
    case 'AI_REVIEW':
    case 'AI_REVIEW_RETRY': {
      if (!task.refId) throw new CoreError('INVALID_INPUT', `${task.type} 任务缺少 refId`);
      const story = getShortStory(task.refId);
      if (!story.currentVersionId) throw new CoreError('INVALID_INPUT', '该小说尚无版本可评审');
      const rec = await runAutoReview(
        story.currentVersionId,
        opts?.provider ? { provider: opts.provider } : {}
      );
      return { recordId: rec.id, score: rec.score, level: rec.level, qualified: rec.qualified };
    }
    case 'AI_OPTIMIZE_STORY': {
      if (!task.refId) throw new CoreError('INVALID_INPUT', 'AI_OPTIMIZE_STORY 任务缺少 refId');
      const recordId = (task.input as { reviewRecordId?: string } | null)?.reviewRecordId;
      if (!recordId) throw new CoreError('INVALID_INPUT', 'AI_OPTIMIZE_STORY 任务缺少 reviewRecordId');
      const story = getShortStory(task.refId);
      if (!story.currentVersionId) throw new CoreError('INVALID_INPUT', '该小说尚无版本可优化');
      const optimized = await runOptimization(
        story.currentVersionId,
        getReviewRecord(recordId),
        { provider: opts?.provider, manual: true }
      );
      return {
        versionId: optimized.version.id,
        version: optimized.version.version,
        charCount: optimized.charCount,
      };
    }
    case 'AI_REVIEW_CHAPTER': {
      if (!task.refId) throw new CoreError('INVALID_INPUT', 'AI_REVIEW_CHAPTER 任务缺少 refId(chapterId)');
      const rec = await runChapterReview(task.refId, opts?.provider ? { provider: opts.provider } : {});
      // V9.5 阶段二补丁:不合格时若未到 chapter_review_max_rounds 上限 → 自动入队优化任务
      // 优化完成后由 AI_OPTIMIZE_CHAPTER case 再入队一次重评,形成评审→优化→重评闭环
      if (!rec.qualified) {
        const row = getDb()
          .prepare(
            `SELECT c.optimize_round, b.chapter_review_max_rounds, b.chapter_review_enabled
             FROM chapters c JOIN books b ON b.id = c.book_id
             WHERE c.id = ?`
          )
          .get(task.refId) as
          | { optimize_round: number; chapter_review_max_rounds: number; chapter_review_enabled: number }
          | undefined;
        if (row && row.chapter_review_enabled === 1 && row.optimize_round < row.chapter_review_max_rounds) {
          // 去重守卫:同章节已有 PENDING/RUNNING 优化任务时不再入队
          const dup = getDb()
            .prepare(
              `SELECT id FROM ai_tasks WHERE type = 'AI_OPTIMIZE_CHAPTER' AND ref_id = ? AND status IN ('PENDING','RUNNING') LIMIT 1`
            )
            .get(task.refId);
          if (!dup) enqueueChapterOptimization(task.refId, rec.id);
        }
      }
      return { recordId: rec.id, score: rec.score, level: rec.level, qualified: rec.qualified };
    }
    case 'AI_OPTIMIZE_CHAPTER': {
      if (!task.refId) throw new CoreError('INVALID_INPUT', 'AI_OPTIMIZE_CHAPTER 任务缺少 refId(chapterId)');
      const reviewRecordId = (task.input as { reviewRecordId?: string } | null)?.reviewRecordId;
      if (!reviewRecordId) throw new CoreError('INVALID_INPUT', 'AI_OPTIMIZE_CHAPTER 任务缺少 reviewRecordId');
      const record = getReviewRecord(reviewRecordId);
      const opt = await runChapterOptimization(task.refId, record, opts?.provider ? { provider: opts.provider } : {});
      // 优化完成后自动入队一次重评(闭环;重评仍不合格时受轮数上限约束不再入队优化)
      // 去重守卫:已有 PENDING/RUNNING 重评任务时跳过
      const dupReview = getDb()
        .prepare(
          `SELECT id FROM ai_tasks WHERE type = 'AI_REVIEW_CHAPTER' AND ref_id = ? AND status IN ('PENDING','RUNNING') LIMIT 1`
        )
        .get(task.refId);
      if (!dupReview) enqueueChapterReview(task.refId);
      return { chapterId: opt.chapterId, optimizeRound: opt.newOptimizeRound, charCount: opt.charCount };
    }
    case 'AI_REVIEW_ARC': {
      const input = task.input as { bookId: string; arcLabel: string; fromChapter: number; toChapter: number } | null;
      if (!input?.bookId) throw new CoreError('INVALID_INPUT', 'AI_REVIEW_ARC 任务缺少 bookId');
      const rec = await runArcReview(input.bookId, {
        arcLabel: input.arcLabel,
        fromChapter: input.fromChapter,
        toChapter: input.toChapter,
        ...(opts?.provider ? { provider: opts.provider } : {}),
      });
      return { recordId: rec.id, score: rec.score, level: rec.level, qualified: rec.qualified };
    }
    case 'PUBLISH_SHORT_STORY': {
      if (!task.refId) throw new CoreError('INVALID_INPUT', 'PUBLISH_SHORT_STORY 任务缺少 refId(storyId)');
      const { publishShortStory } = await import('./short-story-publication');
      const pub = publishShortStory(task.refId);
      return { publicationId: pub.publicationId, bookId: pub.bookId, bookSlug: pub.bookSlug };
    }
    default:
      throw new CoreError('INVALID_INPUT', `暂不支持的任务类型: ${String(task.type)}`);
  }
}

export interface ProcessAiTasksOptions extends ExecuteTaskOptions {
  limit?: number;
}

export interface ProcessedTaskResult {
  taskId: string;
  type: string;
  ok: boolean;
  error?: string;
}

/**
 * 领取并串行执行一批 PENDING 任务(FIFO)。单个任务失败不影响后续任务;
 * CREATE_NOVEL 中途失败时把小说置为 failed,错误保留在任务上可见。
 */
export async function processAiTasks(opts?: ProcessAiTasksOptions): Promise<ProcessedTaskResult[]> {
  const tasks = claimPendingTasks(opts?.limit ?? 5);
  const results: ProcessedTaskResult[] = [];
  for (const claimed of tasks) {
    const task = startAiTask(claimed.id);
    try {
      const output = await executeAiTask(task, opts);
      completeAiTask(task.id, { output });
      results.push({ taskId: task.id, type: task.type, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failAiTask(task.id, message);
      if ((task.type === 'CREATE_NOVEL') && task.refId) {
        const s = tryGetShortStory(task.refId);
        if (s && ['generating', 'reviewing', 'optimizing'].includes(s.status)) {
          transitionStory(s.id, 'failed');
        }
      }
      results.push({ taskId: task.id, type: task.type, ok: false, error: message });
    }
  }
  return results;
}
