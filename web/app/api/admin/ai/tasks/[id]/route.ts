import type { NextRequest } from 'next/server';
import { getAiTask } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 任务详情(含输入/Prompt/输出/错误/token/耗时);前端轮询此端点取 assist 结果 */
export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ task: getAiTask(id) });
});
