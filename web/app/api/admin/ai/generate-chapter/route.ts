import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { generateChapterDraft, resolveProviderFromEnv, type GenerateChapterResult } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  bookId: z.string().min(1),
  chapterNumber: z.number().int().positive().optional(),
  instructions: z.string().max(4000).nullish(),
  submitForReview: z.boolean().optional(),
  llmReview: z.boolean().optional(),
});

/**
 * AI 生成下一章草稿。Provider 从环境变量解析(AI_BASE_URL/AI_API_KEY 必填;
 * AI_MODEL 缺省时从上游 /models 自动发现,过滤非对话类取第一个)。
 * 未配置 → 503 AI_NOT_CONFIGURED;上游失败 → 502 AI_PROVIDER_FAILED。
 * 质检不通过时返回 created:false 与问题列表(不落稿)。
 */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, bodySchema);
  const provider = await resolveProviderFromEnv();
  const result: GenerateChapterResult = await generateChapterDraft(body.bookId, {
    provider,
    chapterNumber: body.chapterNumber,
    instructions: body.instructions ?? undefined,
    submitForReview: body.submitForReview,
    llmReview: body.llmReview,
  });
  return json({ result });
});
