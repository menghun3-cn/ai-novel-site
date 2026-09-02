import { getProductionQueue } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 队列与吞吐:按类型积压/运行/近 7 日成败 + 当前 RUNNING + 停用产线数 */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ queue: getProductionQueue() });
});
