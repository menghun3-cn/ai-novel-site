import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { enqueueGenerationJobs } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  bookId: z.string().min(1),
  count: z.number().int().min(1).max(50),
});

/** 批量入队生成任务(AI 生成前 N 章);实际执行由调度器或 POST /serial/run 处理 */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, bodySchema);
  return json({ jobs: enqueueGenerationJobs(body.bookId, body.count) });
});
