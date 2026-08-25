import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { updateRuleVersion } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ vid: string }> };

const dimensionSchema = z.object({
  name: z.string().min(1).max(60),
  weight: z.number(),
  definition: z.string().max(2000).optional(),
  standards: z
    .array(z.object({ min: z.number(), max: z.number(), description: z.string().max(2000) }))
    .optional(),
  bonus: z.string().max(2000).optional(),
  penalty: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

const patchSchema = z.object({
  dimensions: z.array(dimensionSchema).min(1).optional(),
  qualityThreshold: z.number().int().min(0).max(100).optional(),
  maxAutoOptimizeRounds: z.number().int().min(0).max(10).optional(),
  promptId: z.string().nullish(),
  status: z.enum(['draft', 'testing']).optional(),
});

/** 编辑未上线版本(draft/testing);published/disabled 一律拒绝 */
export const PUT = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { vid } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  return json({ version: updateRuleVersion(vid, patch) });
});
