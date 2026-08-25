import type { NextRequest } from 'next/server';
import { listAiTasks } from '@novel/core';
import { json, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** AI 任务列表(?type=&status=&refType=&refId=&limit=),创建时间倒序 */
export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = new URL(req.url).searchParams;
  return json({
    tasks: listAiTasks({
      type: sp.get('type') ?? undefined,
      status: sp.get('status') ?? undefined,
      refType: sp.get('refType') ?? undefined,
      refId: sp.get('refId') ?? undefined,
      limit: Number(sp.get('limit') ?? '200') || 200,
    }),
  });
});
