import type { NextRequest } from 'next/server';
import { listPendingReview } from '@novel/core';
import { AdminRouteContext, intQuery, json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 全库待审核队列:按提交先后排序,支持 limit/offset 分页 */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  const limit = intQuery(sp, 'limit') ?? 100;
  const offset = intQuery(sp, 'offset') ?? 0;
  return json({ items: listPendingReview(limit, offset) });
});
