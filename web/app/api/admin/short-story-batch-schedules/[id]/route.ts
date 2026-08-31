import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteBatchSchedule, updateBatchSchedule } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 删除批量定时记录(执行中禁止删除;已创建的短篇独立保留,不受影响) */
export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteBatchSchedule(id);
  return json({ deleted: true });
});

const updateSchema = z.object({
  /** UTC ISO 串(前端 datetime-local 转 UTC 后传入),精度到分钟;每日计划取其中的时刻 */
  scheduledAt: z.string().min(1).optional(),
  /** 到点生成的短篇数量(1..50) */
  count: z.number().int().min(1).max(50).optional(),
  /** 每篇共用的创作需求(可空=自由创作) */
  brief: z.record(z.unknown()).optional(),
  /** 是否每天同一时刻重复触发 */
  repeatDaily: z.boolean().optional(),
});

/** 修改批量定时计划(仅 pending / failed 可改;如把 10:00 改为 10:30;部分字段缺省时保持原值) */
export const PATCH = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, updateSchema);
  return json({ schedule: updateBatchSchedule(id, body) });
});
