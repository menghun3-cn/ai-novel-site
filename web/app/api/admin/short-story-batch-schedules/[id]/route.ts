import type { NextRequest } from 'next/server';
import { deleteBatchSchedule } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 删除批量定时记录(执行中禁止删除;已创建的短篇独立保留,不受影响) */
export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteBatchSchedule(id);
  return json({ deleted: true });
});
