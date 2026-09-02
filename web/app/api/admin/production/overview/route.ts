import { getProductionOverview } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 内容工厂指挥中心:总览(产线健康 + 漏斗 + 产线泳道 + 告警 + 最近运行) */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ overview: getProductionOverview() });
});
