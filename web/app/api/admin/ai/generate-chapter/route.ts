import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { generateChapterDraft, getLlmSecretConfig, resolveProvider, type GenerateChapterResult } from '@novel/core';
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
 * AI 生成下一章草稿。Provider 配置优先取后台设置(app_settings),缺省回退环境变量;
 * 模型仍可自动发现。未配置 → 503;上游失败 → 502。
 * 质检不通过时返回 created:false 与问题列表(不落稿)。
 */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, bodySchema);
  const stored = getLlmSecretConfig();
  const provider = await resolveProvider({
    baseUrl: stored.baseUrl || process.env.AI_BASE_URL,
    apiKey: stored.apiKey || process.env.AI_API_KEY,
    model: stored.model || process.env.AI_MODEL,
  });
  const result: GenerateChapterResult = await generateChapterDraft(body.bookId, {
    provider,
    chapterNumber: body.chapterNumber,
    instructions: body.instructions ?? undefined,
    submitForReview: body.submitForReview,
    llmReview: body.llmReview,
  });
  return json({ result });
});
