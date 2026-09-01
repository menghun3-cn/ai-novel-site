import { revalidatePath } from 'next/cache';
import { runPublishCycle } from '@novel/core';
import { AdminRouteContext, json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/**
 * 手动触发一次发布周期(到期定时发布 + 每日自动发布)。
 * 常驻调度器(scripts/publish-scheduler.ts)之外的人工兜底入口。
 *
 * 发布会新增/上线章节,影响书详情与章节页;runPublishCycle 不返回具体书 id,
 * 且这是低频管理动作,故对整个站点缓存做一次重验证,保证新增章节立即可见。
 */
export const POST = withAdmin<AdminRouteContext>(async () => {
  const result = runPublishCycle();
  // 只要有东西被发布,就整体重验证;调度器旁路发布仍靠 ISR revalidate 兜底。
  if (result.duePublished > 0 || result.autopilotPublished > 0) {
    revalidatePath('/', 'layout');
  }
  return json({ result });
});
