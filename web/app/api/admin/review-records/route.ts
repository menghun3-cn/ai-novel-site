import type { NextRequest } from 'next/server';
import { listReviewRecords } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 评审记录列表(?storyId=&ruleVersion=&limit=),创建时间倒序 */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  return json({
    records: listReviewRecords({
      storyId: sp.get('storyId') ?? undefined,
      ruleVersion: sp.get('ruleVersion') ?? undefined,
      limit: Number(sp.get('limit') ?? '200') || 200,
    }),
  });
});
