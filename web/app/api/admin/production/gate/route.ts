import { getProductionGate } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 质量闸门:低质量池列表 + 各产线达标情况(评分/通过率/阈值) */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ gate: getProductionGate() });
});
