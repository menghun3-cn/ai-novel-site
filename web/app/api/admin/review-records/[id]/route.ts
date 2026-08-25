import { getReviewRecord } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 评审记录详情(含 raw_response 与完整结构化结果;回答规格书 §47 全部追溯问题) */
export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ record: getReviewRecord(id) });
});
