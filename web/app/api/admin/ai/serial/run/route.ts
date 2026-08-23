import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { processGenerationJobs, listGenerationJobs, getDb } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';
import { kickProcessing } from '@/lib/serial-worker';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  /** sync(默认)= 等待处理完成;background = 立即返回,进程内继续执行(反代友好) */
  mode: z.enum(['sync', 'background']).optional(),
});

function countActive(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM generation_jobs WHERE status IN ('pending','running')")
    .get() as { n: number };
  return row.n;
}

/**
 * 处理生成队列(与调度器同一执行器)。
 * mode=background 时立即返回 {started},由前端轮询 /serial/jobs 取结果——
 * 避免真实网关长调用触发反向代理 504。
 */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, bodySchema);
  if (body.mode === 'background') {
    const kick = kickProcessing(body.limit ?? 20);
    return json({ started: kick.started, alreadyRunning: kick.alreadyRunning, pending: countActive() });
  }
  const { processed } = await processGenerationJobs(body.limit ?? 10);
  return json({ processed, jobs: listGenerationJobs(undefined, 50) });
});
