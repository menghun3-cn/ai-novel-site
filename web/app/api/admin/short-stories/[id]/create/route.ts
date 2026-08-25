import type { NextRequest } from 'next/server';
import { enqueueCreationPipeline, getShortStory } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';
import { kickStoryWorker } from '@/lib/story-worker';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 启动创作流水线(异步):入队 CREATE_NOVEL 任务并 kick 进程内 worker */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const story = getShortStory(id); // 存在性守卫
  const task = enqueueCreationPipeline(id);
  kickStoryWorker();
  return json({ task, story: getShortStory(id) ?? story }, 202);
});
