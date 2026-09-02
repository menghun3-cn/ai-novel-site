import { getProductionCost } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 成本/ROI:按日、按产线的 token 与估算成本,以及单篇发布成本 */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ cost: getProductionCost() });
});
