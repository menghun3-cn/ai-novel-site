import { getProductionExceptions } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 异常分诊:失败任务/失败创作/低质池/配额超限/规则离线/停用产线 的待办工作队列 */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ exceptions: getProductionExceptions() });
});
