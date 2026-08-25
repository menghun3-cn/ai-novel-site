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
import { getReviewRecord, latestReviewForVersion, runAutoReview } from './review-engine';
import { runOptimization } from './optimize-engine';
import { executeAssistTask, type AssistTaskInput } from './ai-assist';
import {
  appendVersion,
  getShortStory,
  setFinalVersion,
  transitionStory,
  tryGetShortStory,
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
    '# 创作要求',
    ...(briefLines(brief).length > 0 ? briefLines(brief) : ['- 主题与题材不限,自由发挥一篇有完整故事性的短篇。']),
    '',
    '# 硬性要求',
    `- 正文篇幅约 ${target} 字(允许上下浮动 10%,不要超过 ${MAX_TARGET_WORDS} 字)。`,
    '- 故事必须包含明确的开端、冲突、发展、高潮与结局,前后呼应。',
    '- 直接输出正文(Markdown),不要输出标题解释、创作说明或任何自我引用。',
  ];
  return parts.join('\n');
}

const CREATION_SYSTEM =
  '你是资深短篇小说作者。严格遵循用户消息中的创作要求写作;直接输出小说正文,不要任何解释。';

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
  if (story.status !== 'draft' && story.status !== 'failed') {
    throw new CoreError('INVALID_INPUT', `当前状态 ${story.status} 不允许启动创作流水线(仅草稿/失败可重跑)`);
  }
  const ruleVersion = getActiveRuleVersion();
  if (!ruleVersion) {
    throw new CoreError('REVIEW_RULE_NOT_FOUND', '没有已发布的评审规则版本,无法启动自动评审闭环');
  }

  const provider = opts?.provider ?? (await resolveProviderFromStore());
  transitionStory(storyId, 'generating');

  // 阶段一:整篇生成
  const prompt = buildCreationPrompt(story.brief);
  const raw = await provider.complete({
    system: CREATION_SYSTEM,
    prompt,
    maxTokens: 8000,
    temperature: 0.85,
  });
  const content = raw.replace(/^#\s+.+\n+/, '').trim();
  const quality = qualityCheckChapter(content, { minChars: 500 });
  if (!quality.ok) {
    throw new CoreError(
      'AI_PROVIDER_FAILED',
      `生成内容未通过基础质检:${quality.issues.map((i) => i.detail).join(';')}`
    );
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
      return { status: 'passed', finalVersionId: current.id, score: record.score, autoOptimizeRounds: autoRounds };
    }
    if (autoRounds >= ruleVersion.maxAutoOptimizeRounds) {
      // 达到最大优化次数仍未达标 → 低质量内容池(规格书 §22)
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

/** 启动创作流水线(draft/failed 可入队);返回任务供前端轮询 */
export function enqueueCreationPipeline(storyId: string): AiTask {
  const story = getShortStory(storyId);
  if (story.status !== 'draft' && story.status !== 'failed') {
    throw new CoreError('INVALID_INPUT', `当前状态 ${story.status} 不允许入队创作(仅草稿/失败可重跑)`);
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
