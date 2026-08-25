import { disableRuleVersion } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vid: string }> };

/** 停用规则版本 */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { vid } = await ctx.params;
  return json({ version: disableRuleVersion(vid) });
});
