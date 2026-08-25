import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { addRuleVersion } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

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

const createSchema = z.object({
  version: z.string().max(20).optional(),
  dimensions: z.array(dimensionSchema).min(1),
  qualityThreshold: z.number().int().min(0).max(100).optional(),
  maxAutoOptimizeRounds: z.number().int().min(0).max(10).optional(),
  promptId: z.string().nullish(),
});

/** 为规则追加新版本(draft;缺省版本号自动 minor+1) */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, createSchema);
  return json({ version: addRuleVersion(id, body) }, 201);
});
