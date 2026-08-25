import { getReviewStats } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 质量数据基础统计:评审数/通过率/平均分/平均优化轮次/作品状态分布 */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ stats: getReviewStats() });
});
