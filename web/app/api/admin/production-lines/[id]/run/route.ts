import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { runProductionLine } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const runSchema = z.object({
  /** 触发方式:manual(默认)/daily */
  trigger: z.enum(['manual', 'daily']).optional(),
  /** 本次运行篇数(覆盖产线默认,受单次上限约束) */
  count: z.number().int().min(1).max(50).optional(),
});

/** 手动触发一次产线运行:批量生成该批次分配好的不同题材/类型短篇并逐篇入队流水线 */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, runSchema);
  const result = runProductionLine(id, { trigger: body.trigger ?? 'manual', count: body.count });
  return json({ run: result.run, createdStoryIds: result.createdStoryIds }, 201);
});
