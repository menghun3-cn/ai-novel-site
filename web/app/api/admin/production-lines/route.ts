import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createProductionLine, getProductionLinesWithMeta } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
  config: z.unknown(),
});

/** 产线清单(带运行/产出概览),供产线页渲染 */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ lines: getProductionLinesWithMeta() });
});

/** 新建产线(校验题材/调度/配额等配置) */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, createSchema);
  return json({ line: createProductionLine({ name: body.name, description: body.description ?? null, enabled: body.enabled ?? true, config: body.config }) }, 201);
});
