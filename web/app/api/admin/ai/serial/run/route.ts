import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { processGenerationJobs, listGenerationJobs } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * 手动处理一次生成队列(与调度器同一执行器):逐任务 生成→质检→送审/发布。
 * 返回处理数与执行后的最新任务列表(便于前端直接刷新)。
 */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, bodySchema);
  const { processed } = await processGenerationJobs(body.limit ?? 10);
  return json({ processed, jobs: listGenerationJobs(undefined, 50) });
});
