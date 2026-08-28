import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { cancelShortStorySchedule, getShortStory, scheduleShortStory } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const scheduleSchema = z.object({
  /** UTC ISO 串(前端 datetime-local 转 UTC 后传入),精度到分钟 */
  scheduledAt: z.string().min(1),
});

/** 设定/调整单篇短篇的定时创作时间(切 status 到 scheduled,由调度器到点触发流水线) */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, scheduleSchema);
  getShortStory(id); // 存在性守卫
  return json({ story: scheduleShortStory(id, body.scheduledAt) });
});

/** 取消单篇短篇的定时创作(回退到 draft 并清空 scheduled_at) */
export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ story: cancelShortStorySchedule(id) });
});
