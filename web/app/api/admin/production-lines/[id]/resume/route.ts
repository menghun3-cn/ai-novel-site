import { resumeProductionLine } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/**
 * 恢复熔断的持续产线:enabled=1 + 清零连续失败 + 清 tripped 痕迹。
 * 幂等:未熔断的产线调用等同启用。
 */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ line: resumeProductionLine(id) });
});
