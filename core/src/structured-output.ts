// V9 结构化输出层(规格书 §37):提示词注入输出格式 → 容错提取 JSON → 校验 →
// 失败把解析错误反馈给模型重试,默认最多 2 次重试;仍失败抛 STRUCTURED_OUTPUT_FAILED
// core 零框架:校验器由调用方以回调注入,不引入 zod

import { CoreError } from './domain';
import type { LlmCompleteRequest, LlmProvider } from './ai-writer';

/** 结构化输出的额外重试次数(首次之外) */
export const STRUCTURED_OUTPUT_RETRIES = 2;

/**
 * 从模型原始输出中提取第一个平衡的 JSON 对象:
 * 剥 ```json 围栏、跳过前后杂文;找不到返回 undefined。
 */
export function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  let text = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export interface StructuredRequest extends LlmCompleteRequest {
  /** 输出格式说明(字段与约束),追加在用户消息末尾 */
  schemaDescription: string;
}

export interface StructuredResult<T> {
  data: T;
  /** 最终一次的模型原始输出(入库留痕用) */
  raw: string;
  /** 实际调用次数(含重试) */
  attempts: number;
}

/**
 * 带重试的结构化补全:parse 在成功时返回业务对象、失败时 throw Error(message),
 * 该 message 会作为反馈拼进下一次请求让模型自纠。
 */
export async function completeStructured<T>(
  provider: LlmProvider,
  req: StructuredRequest,
  parse: (data: Record<string, unknown>, raw: string) => T
): Promise<StructuredResult<T>> {
  const formatBlock = `\n\n# 输出格式要求\n${req.schemaDescription}\n只输出一个符合上述格式的 JSON 对象,不要输出任何解释文字或代码块标记。`;
  let lastRaw = '';
  let lastError = 'empty response';
  for (let attempt = 0; attempt <= STRUCTURED_OUTPUT_RETRIES; attempt++) {
    const prompt =
      attempt === 0 ? `${req.prompt}${formatBlock}` : `${req.prompt}${formatBlock}\n\n# 上一次输出解析失败\n原因:${lastError}\n请修正后重新输出,仍然只输出 JSON 对象。`;
    lastRaw = await provider.complete({ system: req.system, prompt, maxTokens: req.maxTokens, temperature: req.temperature });
    const obj = extractJsonObject(lastRaw);
    if (!obj) {
      lastError = '输出中未找到可解析的 JSON 对象';
      continue;
    }
    try {
      return { data: parse(obj, lastRaw), raw: lastRaw, attempts: attempt + 1 };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new CoreError(
    'STRUCTURED_OUTPUT_FAILED',
    `结构化输出在 ${STRUCTURED_OUTPUT_RETRIES + 1} 次尝试后仍无法解析:${lastError};最后原始输出片段:${lastRaw.slice(0, 300)}`
  );
}
