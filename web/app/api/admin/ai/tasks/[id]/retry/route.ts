import type { NextRequest } from 'next/server';
import { retryAiTask } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';
import { kickStoryWorker } from '@/lib/story-worker';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 重试 FAILED 任务:置回 PENDING 并立即 kick */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const task = retryAiTask(id);
  kickStoryWorker();
  return json({ task });
});
