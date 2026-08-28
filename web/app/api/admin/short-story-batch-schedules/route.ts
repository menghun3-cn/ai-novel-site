import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createBatchSchedule, listBatchSchedules } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  /** UTC ISO 串(前端 datetime-local 转 UTC 后传入),精度到分钟 */
  scheduledAt: z.string().min(1),
  /** 到点生成的短篇数量(1..50) */
  count: z.number().int().min(1).max(50),
  /** 每篇共用的创作需求(可空=自由创作) */
  brief: z.record(z.unknown()).optional(),
});

/** 批量定时计划列表(?status=&limit=) */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  return json({
    schedules: listBatchSchedules({
      status: sp.get('status') ?? undefined,
      limit: Number(sp.get('limit') ?? '200') || 200,
    }),
  });
});

/** 新建批量定时计划(pending;到点由调度器一次性创建 count 篇短篇并逐篇入队创作流水线) */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, createSchema);
  return json({ schedule: createBatchSchedule(body) }, 201);
});
