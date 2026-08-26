import { getReviewStats, getReviewTrendStats } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 质量数据统计:基础计数 + 7 日趋势/维度均分/弧评汇总(?trend=0 可跳过趋势) */
export const GET = withAdmin<AdminRouteContext>(async (req) => {
  const stats = getReviewStats();
  const withTrend = new URL(req.url).searchParams.get('trend') !== '0';
  return json({ stats, trend: withTrend ? getReviewTrendStats(7) : null });
});
