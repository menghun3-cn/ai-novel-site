import type { NextRequest } from 'next/server';
import { enqueueManualOptimize } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';
import { kickStoryWorker } from '@/lib/story-worker';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 手动优化当前最终版(异步任务;不受自动轮数上限约束,独立计数) */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const task = enqueueManualOptimize(id);
  kickStoryWorker();
  return json({ task }, 202);
});
