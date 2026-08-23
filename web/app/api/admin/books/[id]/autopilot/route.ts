import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { configureAutopilot, getAutopilotConfig } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    count: z.number().int().min(1).max(50),
  })
  .partial();

/** 查询某书的每日自动发布配置 */
export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ autopilot: getAutopilotConfig(id) });
});

/** 配置某书的每日自动发布(hour 0-23,count 1-50);非法值由服务层映射 400 */
export const PUT = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  return json({ autopilot: configureAutopilot(id, patch) });
});
