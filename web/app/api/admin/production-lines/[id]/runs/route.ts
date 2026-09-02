import { listProductionRuns } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** 某产线的运行历史 */
export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ runs: listProductionRuns({ lineId: id, limit: 100 }) });
});
