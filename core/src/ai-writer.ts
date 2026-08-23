// V4 AI Writer 引擎:可插拔 LLM Provider + 章节草稿生成 + 规则质检 + 可选 LLM 复核
// 落稿复用 Content Core:createChapter(draft) → submitChapterForReview,走既有状态机

import { getDb } from './db';
import { CoreError } from './domain';
import { createChapter, submitChapterForReview } from './service';
import { getGenerationContext, renderGenerationPrompt, type GenerationContext } from './story-context';

// ---------- Provider 抽象 ----------

export interface LlmCompleteRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmCompleteRequest): Promise<string>;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * OpenAI 兼容 chat completions 适配器(DeepSeek/OpenAI/本地网关均可)。
 * baseUrl 形如 https://api.deepseek.com(不含 /chat/completions)。
 */
export function createOpenAiCompatibleProvider(cfg: OpenAiCompatibleConfig): LlmProvider {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return {
    name: `openai-compatible:${cfg.model}`,
    async complete(req: LlmCompleteRequest): Promise<string> {
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              ...(req.system ? [{ role: 'system', content: req.system }] : []),
              { role: 'user', content: req.prompt },
            ],
            max_tokens: req.maxTokens ?? 8000,
            temperature: req.temperature ?? 0.8,
            stream: false,
          }),
        });
      } catch (err) {
        throw new CoreError('AI_PROVIDER_FAILED', `network error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new CoreError('AI_PROVIDER_FAILED', `provider ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw new CoreError('AI_PROVIDER_FAILED', 'provider returned empty completion');
      }
      return text.trim();
    },
  };
}

/**
 * 非对话类模型过滤:模型自动发现时排除 embedding/rerank/音频/图像/审核类,
 * 剩余取列表第一个。命中即排除,大小写不敏感。
 */
const NON_CHAT_MODEL_PATTERN = /embed|rerank|whisper|tts|audio|dall-e|image|moderation|guard|vision/i;

/** 从 OpenAI 兼容上游 GET /models 拉取并选出第一个对话模型 */
async function discoverFirstChatModel(baseUrl: string, apiKey: string): Promise<string> {
  const base = baseUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  } catch (err) {
    throw new CoreError('AI_PROVIDER_FAILED', `model discovery network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CoreError('AI_PROVIDER_FAILED', `model discovery ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const eligible = ids.filter((id) => !NON_CHAT_MODEL_PATTERN.test(id));
  if (eligible.length === 0) {
    throw new CoreError('AI_NOT_CONFIGURED', `no eligible chat model in /models (${ids.length} listed; AI_MODEL can be set explicitly)`);
  }
  return eligible[0];
}

/** 已解析的 (baseUrl,apiKey) → model 缓存,避免每次生成都打 /models */
const resolvedModelCache = new Map<string, string>();

/**
 * 从环境变量解析 Provider。AI_BASE_URL / AI_API_KEY 必填(缺 → AI_NOT_CONFIGURED,503);
 * AI_MODEL 可选——缺省时从 `${baseUrl}/models` 自动发现,过滤非对话类后取第一个
 * (发现失败 → AI_PROVIDER_FAILED,502;列表无非对话外模型 → AI_NOT_CONFIGURED)。
 * 注意:异步;发现结果按 baseUrl+apiKey 缓存。
 */
export async function resolveProviderFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<LlmProvider> {
  const baseUrl = env.AI_BASE_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    throw new CoreError('AI_NOT_CONFIGURED', 'AI_BASE_URL / AI_API_KEY must be set');
  }
  const explicit = env.AI_MODEL?.trim();
  let model = explicit || resolvedModelCache.get(`${baseUrl}|${apiKey}`) || '';
  if (!model) {
    model = await discoverFirstChatModel(baseUrl, apiKey);
    resolvedModelCache.set(`${baseUrl}|${apiKey}`, model);
  }
  return createOpenAiCompatibleProvider({ baseUrl, apiKey, model });
}

/** 清空模型发现缓存(测试用) */
export function clearProviderCache(): void {
  resolvedModelCache.clear();
}

/** 测试/离线用固定回声 Provider */
export function createFakeProvider(responder: (prompt: string) => string): LlmProvider & { calls: string[] } {
  return {
    name: 'fake',
    calls: [],
    async complete(req) {
      this.calls.push(req.prompt);
      return responder(req.prompt);
    },
  };
}

// ---------- 规则质检 ----------

export interface QualityIssue {
  code: 'TOO_SHORT' | 'AI_MARKERS' | 'HIGH_REPETITION';
  detail: string;
}

export interface QualityReport {
  ok: boolean;
  issues: QualityIssue[];
}

const AI_MARKER_PATTERN = /作为(一个)?AI|作为一个?语言模型|我无法提供|抱歉,?(我|无法)/;

function maxWindowRepeat(text: string, windowChars = 60): number {
  if (text.length < windowChars * 2) return 1;
  const windows = new Map<string, number>();
  let max = 1;
  for (let i = 0; i + windowChars <= text.length; i += windowChars / 2) {
    const w = text.slice(i, i + windowChars);
    const n = (windows.get(w) ?? 0) + 1;
    windows.set(w, n);
    if (n > max) max = n;
  }
  return max;
}

/** 规则质检:长度下限、AI 自述标记、滑窗重复率。纯函数,不触库。 */
export function qualityCheckChapter(text: string, opts?: { minChars?: number }): QualityReport {
  const issues: QualityIssue[] = [];
  const clean = text.trim();
  const minChars = opts?.minChars ?? 500;
  if (clean.length < minChars) {
    issues.push({ code: 'TOO_SHORT', detail: `正文 ${clean.length} 字,低于下限 ${minChars}` });
  }
  const marker = AI_MARKER_PATTERN.exec(clean);
  if (marker) {
    issues.push({ code: 'AI_MARKERS', detail: `出现 AI 自述标记:「${marker[0]}」` });
  }
  const repeat = maxWindowRepeat(clean.replace(/\s+/g, ''));
  if (repeat >= 4) {
    issues.push({ code: 'HIGH_REPETITION', detail: `60 字滑窗最大重复 ${repeat} 次` });
  }
  return { ok: issues.length === 0, issues };
}

// ---------- 可选 LLM 复核 ----------

export interface LlmReviewVerdict {
  verdict: 'pass' | 'fail';
  note: string | null;
}

/**
 * LLM 复核:让模型以编辑视角审一章;输出首行必须 PASS 或 FAIL。
 * fail 时章节仍落稿但**不**自动送审(留给人工看)。
 */
export async function llmReviewChapter(provider: LlmProvider, chapterText: string): Promise<LlmReviewVerdict> {
  const out = await provider.complete({
    system: '你是严格的小说编辑。只依据文本质量判断是否达到可发布水准。',
    prompt: `审以下章节正文。第一行只输出 PASS 或 FAIL;第二行起给一句理由(不超过80字)。\n\n${chapterText}`,
    maxTokens: 200,
    temperature: 0.2,
  });
  const firstLine = out.trim().split('\n')[0]?.toUpperCase() ?? '';
  const note = out.trim().split('\n').slice(1).join(' ').trim() || null;
  return firstLine.startsWith('PASS') ? { verdict: 'pass', note } : { verdict: 'fail', note: note ?? 'LLM 复核未通过' };
}

// ---------- 章节生成主流程 ----------

export interface GenerateChapterOptions {
  provider: LlmProvider;
  /** 目标章号;缺省为下一章 */
  chapterNumber?: number;
  /** 额外指令(追加在大纲节之后) */
  instructions?: string;
  /** 质检通过后自动送审(pending_review);默认 false 只落 draft */
  submitForReview?: boolean;
  /** 先做 LLM 复核;复核 fail 时即使 submitForReview=true 也停在 draft 并附 note */
  llmReview?: boolean;
  /** 质检最短字数,默认 500 */
  minChars?: number;
}

export type GenerateChapterResult =
  | {
      created: true;
      chapterNumber: number;
      title: string;
      chars: number;
      quality: QualityReport;
      llmReview: LlmReviewVerdict | null;
      submitted: boolean;
      holdNote: string | null;
    }
  | { created: false; reason: 'quality'; quality: QualityReport; promptChars: number };

function extractTitle(text: string, fallbackOutlineTitle: string | undefined, chapterNumber: number): string {
  const heading = /^#\s+(.{1,40})\s*$/m.exec(text);
  if (heading) return heading[1].trim();
  if (fallbackOutlineTitle && fallbackOutlineTitle.trim()) return fallbackOutlineTitle.trim();
  return `第${chapterNumber}章`;
}

/** 剥掉模型可能输出的首个标题行,避免与章节 title 字段重复出现在正文中 */
function stripLeadingHeading(text: string): string {
  return text.replace(/^#\s+.+\n+/, '').trim();
}

export async function generateChapterDraft(
  bookId: string,
  opts: GenerateChapterOptions
): Promise<GenerateChapterResult> {
  const ctx: GenerationContext = getGenerationContext(bookId, { chapterNumber: opts.chapterNumber });
  const promptBase = renderGenerationPrompt(ctx);
  const prompt = opts.instructions ? `${promptBase}\n\n# 额外指令\n${opts.instructions}` : promptBase;

  const raw = await opts.provider.complete({
    system:
      '你是资深网络小说作者。严格遵循用户消息中的世界观、人物、规则与大纲写作;直接输出章节正文(Markdown),可带一个一级标题,不要任何解释或自我引用。',
    prompt,
    maxTokens: 8000,
    temperature: 0.8,
  });

  const quality = qualityCheckChapter(raw, { minChars: opts.minChars });
  if (!quality.ok) {
    return { created: false, reason: 'quality', quality, promptChars: prompt.length };
  }

  const review = opts.llmReview ? await llmReviewChapter(opts.provider, raw) : null;
  const holdByReview = review?.verdict === 'fail';

  const title = extractTitle(raw, ctx.outline?.title, ctx.nextChapterNumber);
  const contentMd = stripLeadingHeading(raw);
  createChapter({ bookId, number: ctx.nextChapterNumber, title, contentMd, status: 'draft' });

  let submitted = false;
  let holdNote: string | null = null;
  if (opts.submitForReview && !holdByReview) {
    submitChapterForReview(bookId, ctx.nextChapterNumber);
    submitted = true;
  } else if (holdByReview) {
    const db = getDb();
    db.prepare('UPDATE chapters SET review_note = ? WHERE book_id = ? AND number = ?').run(
      `LLM 复核暂扣:${review?.note ?? ''}`,
      bookId,
      ctx.nextChapterNumber
    );
    holdNote = review?.note ?? null;
  }

  return {
    created: true,
    chapterNumber: ctx.nextChapterNumber,
    title,
    chars: contentMd.length,
    quality,
    llmReview: review,
    submitted,
    holdNote,
  };
}
