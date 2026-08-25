// V9 字段级 AI 辅助(规格书 §6-§8):AI建议(多候选)/AI生成(整段内容)/AI优化(保意图改进)
// 执行器以 ai_tasks 为输入/输出载体:input{action,field,value?,context} → output{options?|result?}

import {
  SHORT_STORY_FIELD_LABELS,
  type AiAssistAction,
  type AiTask,
  type StoryBrief,
} from './domain';
import { CoreError } from './domain';
import type { LlmProvider } from './ai-writer';
import { completeStructured } from './structured-output';
import { resolveProviderFromStore } from './settings';

export interface AssistTaskInput {
  action: AiAssistAction;
  /** 字段键(title 或 StoryBrief 键) */
  field: string;
  /** optimize 动作:当前值 */
  value?: string;
  /** 已填写的其他字段(上下文连贯性) */
  context?: StoryBrief;
  /** 建议数量(suggest),默认 4 */
  count?: number;
}

const ASSIST_SYSTEM =
  '你是小说创作助手。严格按用户消息的格式要求输出;建议要具体、有画面感、可执行,拒绝空话套话。';

function fieldLabel(field: string): string {
  return SHORT_STORY_FIELD_LABELS[field] ?? field;
}

function renderContext(context?: StoryBrief): string {
  if (!context) return '(暂无其他信息)';
  const entries = Object.entries(context).filter(([, v]) => v !== undefined && String(v).trim() !== '');
  if (entries.length === 0) return '(暂无其他信息)';
  return entries.map(([k, v]) => `- ${SHORT_STORY_FIELD_LABELS[k] ?? k}:${String(v)}`).join('\n');
}

/** AI建议:suggest → 多个候选方案(JSON 数组,校验后返回) */
async function runSuggest(provider: LlmProvider, input: AssistTaskInput): Promise<string[]> {
  const count = Math.min(Math.max(input.count ?? 4, 2), 8);
  const result = await completeStructured(
    provider,
    {
      system: ASSIST_SYSTEM,
      prompt: [
        `请为短篇小说的创作字段「${fieldLabel(input.field)}」提供 ${count} 个候选方案。`,
        '',
        '# 已有创作信息',
        renderContext(input.context),
      ].join('\n'),
      temperature: 0.9,
      maxTokens: 1500,
      schemaDescription: `{"options": ["候选1", "候选2", ..., 共 ${count} 条]}\n每条候选为一句话方案,风格角度各不相同,可直接采用。`,
    },
    (obj) => {
      const options = obj.options;
      if (!Array.isArray(options)) throw new Error('缺少 options 数组');
      const list = options.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      if (list.length < 2) throw new Error(`有效候选不足 2 条(收到 ${list.length})`);
      return list.slice(0, count);
    }
  );
  return result.data;
}

/** AI生成:根据上下文整段生成该字段内容 */
async function runGenerate(provider: LlmProvider, input: AssistTaskInput): Promise<string> {
  const raw = await provider.complete({
    system: ASSIST_SYSTEM,
    prompt: [
      `请为短篇小说的创作字段「${fieldLabel(input.field)}」生成完整内容。`,
      '',
      '# 已有创作信息',
      renderContext(input.context),
      '',
      '直接输出该字段的内容本身,不要标题、前缀或解释。',
    ].join('\n'),
    temperature: 0.85,
    maxTokens: 2000,
  });
  return raw.trim();
}

/** AI优化:保留用户核心意图的前提下修复与提升(规格书 §8) */
async function runOptimizeField(provider: LlmProvider, input: AssistTaskInput): Promise<string> {
  const value = input.value?.trim();
  if (!value) throw new CoreError('INVALID_INPUT', 'AI优化需要字段的当前值');
  const raw = await provider.complete({
    system: ASSIST_SYSTEM,
    prompt: [
      `请优化短篇小说创作字段「${fieldLabel(input.field)}」的已有内容。`,
      '',
      '# 优化要求',
      '- 保留用户的核心意图与关键信息,不得无意义重写。',
      '- 修复逻辑问题,提升表达,增强故事性。',
      '- 直接输出优化后的内容本身,不要解释或对比。',
      '',
      '# 已有创作信息',
      renderContext(input.context),
      '',
      `# 当前内容(${fieldLabel(input.field)})`,
      value,
    ].join('\n'),
    temperature: 0.7,
    maxTokens: 2500,
  });
  return raw.trim();
}

/** 任务执行入口:按 action 分派;产出写入任务 output */
export async function executeAssistTask(task: AiTask, opts?: { provider?: LlmProvider }): Promise<Record<string, unknown>> {
  const input = task.input as AssistTaskInput | null;
  if (!input || typeof input.action !== 'string' || typeof input.field !== 'string') {
    throw new CoreError('INVALID_INPUT', 'assist 任务缺少 input.action / input.field');
  }
  if (!SHORT_STORY_FIELD_LABELS[input.field]) {
    throw new CoreError('INVALID_INPUT', `未知字段: ${input.field}`);
  }
  const provider = opts?.provider ?? (await resolveProviderFromStore());
  switch (input.action) {
    case 'suggest': {
      const options = await runSuggest(provider, input);
      return { options };
    }
    case 'generate': {
      const result = await runGenerate(provider, input);
      return { result };
    }
    case 'optimize': {
      const result = await runOptimizeField(provider, input);
      return { result };
    }
    default:
      throw new CoreError('INVALID_INPUT', `非法 assist 动作: ${String(input.action)}`);
  }
}
