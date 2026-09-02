import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { setProductionLineEnabled } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const toggleSchema = z.object({ enabled: z.boolean() });

/** 启停产线(停用=不再每日触发/手动运行时拒绝;恢复后重新调度) */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, toggleSchema);
  return json({ line: setProductionLineEnabled(id, body.enabled) });
});
