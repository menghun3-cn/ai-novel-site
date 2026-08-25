import { publishRuleVersion } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vid: string }> };

/** 发布为全局唯一生效版本(其余已发布版本自动停用) */
export const POST = withAdmin<Ctx>(async (_req, ctx) => {
  const { vid } = await ctx.params;
  return json({ version: publishRuleVersion(vid) });
});
