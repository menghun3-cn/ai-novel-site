import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { enqueueAssistTask } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';
import { kickStoryWorker } from '@/lib/story-worker';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['suggest', 'generate', 'optimize']),
  field: z.string().min(1).max(60),
  value: z.string().max(20000).optional(),
  count: z.number().int().min(2).max(8).optional(),
  context: z.record(z.unknown()).optional(),
});

/**
 * 字段级 AI 辅助(AI建议/AI生成/AI优化):统一异步任务。
 * 返回 202 + taskId;前端轮询 GET /api/admin/ai/tasks/:id 取结果。
 */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, bodySchema);
  const task = enqueueAssistTask(body);
  kickStoryWorker();
  return json({ task }, 202);
});
