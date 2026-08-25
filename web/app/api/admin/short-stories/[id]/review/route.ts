import type { NextRequest } from 'next/server';
import { enqueueManualReview, getShortStory } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';
import { kickStoryWorker } from '@/lib/story-worker';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 手动重新评审当前版本(异步任务) */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  getShortStory(id);
  const task = enqueueManualReview(id);
  kickStoryWorker();
  return json({ task }, 202);
});
