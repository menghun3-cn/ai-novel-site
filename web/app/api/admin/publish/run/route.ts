import { runPublishCycle } from '@novel/core';
import { AdminRouteContext, json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/**
 * 手动触发一次发布周期(到期定时发布 + 每日自动发布)。
 * 常驻调度器(scripts/publish-scheduler.ts)之外的人工兜底入口。
 */
export const POST = withAdmin<AdminRouteContext>(async () => {
  return json({ result: runPublishCycle() });
});
