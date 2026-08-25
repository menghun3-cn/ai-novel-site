// V9 自动优化引擎(规格书 §20):读原版本+评审问题/建议 → 针对性修订 → 新版本落库
// 约束写进提示词:保留主题/主要人物/核心剧情/用户意图,只针对评审问题修改,不得重写成另一篇小说

import type { ReviewRecord, ShortStory, ShortStoryVersion, StoryBrief } from './domain';
import { SHORT_STORY_FIELD_LABELS } from './domain';
import type { LlmProvider } from './ai-writer';
import { appendVersion, bumpStoryProgress, getShortStory, getStoryVersion } from './short-story';
import { resolveProviderFromStore } from './settings';

const OPTIMIZE_SYSTEM =
  '你是资深的短篇小说改稿编辑。严格在原作基础上做针对性修订,不改变故事的根本设定与走向;直接输出修订后的完整正文(Markdown),不要任何解释。';

export interface BuiltOptimizePrompt {
  prompt: string;
}

function briefLines(brief: StoryBrief | undefined): string[] {
  if (!brief) return [];
  return Object.entries(brief)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => {
      const label = SHORT_STORY_FIELD_LABELS[k] ?? k;
      const value = k === 'targetWords' ? `${String(v)} 字` : String(v);
      return `- ${label}:${value}`;
    });
}

export function buildOptimizationPrompt(input: {
  story: Pick<ShortStory, 'title'>;
  brief?: StoryBrief;
  version: ShortStoryVersion;
  record: ReviewRecord;
}): BuiltOptimizePrompt {
  const lowDims = input.record.dimensionScores
    .slice()
    .sort((a, b) => a.score / Math.max(a.maxScore, 1) - b.score / Math.max(b.maxScore, 1))
    .map((d) => `- ${d.name}(本次 ${d.score}/${d.maxScore}):${d.reason}`);
  const parts: string[] = [
    `请针对评审发现的问题修订以下短篇小说《${input.story.title}》V${input.version.version}。`,
    '',
    '# 修订硬约束',
    '- 保留主题、主要人物、核心剧情与整体走向,不得重写成另一篇故事。',
    '- 只针对下方问题清单做修改;没有涉及的部分尽量保持原文。',
    '- 输出修订后的完整正文(从开头到结尾),不要输出修改说明或对比。',];
  if (input.brief) {
    const lines = briefLines(input.brief);
    if (lines.length > 0) parts.push('', '# 用户创作要求(必须继续满足)', ...lines);
  }
  parts.push(
    '',
    '# 本次评审发现的问题(逐条解决)',
    ...input.record.weaknesses.map((w) => `- 问题:${w}`),
    ...input.record.suggestions.map((s) => `- 建议:${s}`),
    ...(lowDims.length > 0 ? ['', '# 薄弱维度及理由'] : []),
    ...lowDims
  );
  parts.push('', '# 原文(V' + input.version.version + ')', input.version.content);
  return { prompt: parts.join('\n') };
}

export interface RunOptimizationOptions {
  provider?: LlmProvider;
  /** 手动触发:true 时计入 manual_optimize_round(不受自动轮数上限约束) */
  manual?: boolean;
}

export interface OptimizationResult {
  version: ShortStoryVersion;
  /** 实际调用模型产出的字符数 */
  charCount: number;
}

/**
 * 对"已评审的版本"执行一次优化并追加新版本。
 * 记录链:新版本 creation_reason=ai_optimized,generation_prompt/model_name 全程留痕。
 */
export async function runOptimization(
  storyVersionId: string,
  record: ReviewRecord,
  opts?: RunOptimizationOptions
): Promise<OptimizationResult> {
  const version = getStoryVersion(storyVersionId);
  const story = getShortStory(version.storyId);
  const built = buildOptimizationPrompt({ story, brief: story.brief, version, record });

  const provider = opts?.provider ?? (await resolveProviderFromStore());
  const raw = await provider.complete({
    system: OPTIMIZE_SYSTEM,
    prompt: built.prompt,
    maxTokens: 8000,
    temperature: 0.7,
  });
  const content = stripLeadingHeading(raw);
  if (!content || content.length < 100) {
    throw new Error('优化输出过短,疑似未按完整正文返回');
  }

  const next = appendVersion(story.id, {
    content,
    creationReason: 'ai_optimized',
    generationPrompt: built.prompt,
    modelName: provider.name,
  });
  bumpStoryProgress(story.id, {
    optimizeDelta: opts?.manual ? 0 : 1,
    manualOptimizeDelta: opts?.manual ? 1 : 0,
  });
  return { version: next, charCount: content.length };
}

/** 剥掉模型可能输出的首个标题行,避免标题重复出现在正文中(与 ai-writer 同策略) */
function stripLeadingHeading(text: string): string {
  return text.replace(/^#\s+.+\n+/, '').trim();
}
