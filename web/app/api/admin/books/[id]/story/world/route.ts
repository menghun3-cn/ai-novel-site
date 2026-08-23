import { z } from 'zod';
import { upsertWorld } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  setting: z.string().max(20000).optional(),
  rules: z.string().max(10000).optional(),
});

/** 保存世界观/写作规则(部分字段生效) */
export const PUT = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, bodySchema);
  return json({ world: upsertWorld(id, patch) });
});
