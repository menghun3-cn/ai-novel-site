import type { NextRequest } from 'next/server';
import { listGenerationJobs } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 最近生成任务(可选按书过滤);limit 1-200,默认 50 */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const url = new URL(req.url);
  const bookId = url.searchParams.get('bookId') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? '50');
  return json({ jobs: listGenerationJobs(bookId || undefined, Number.isFinite(limit) ? limit : 50) });
});
