import type { NextRequest } from 'next/server';
import { cancelBatchSchedule } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 取消未触发的批量定时计划(仅 pending;取消后不再触发) */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ schedule: cancelBatchSchedule(id) });
});
