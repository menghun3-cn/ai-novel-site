import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createReviewRule, listReviewRules } from '@novel/core';
import { json, readJson, withAdmin, type AdminRouteContext } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

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
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  version: z.string().max(20).optional(),
  dimensions: z.array(dimensionSchema).min(1),
  qualityThreshold: z.number().int().min(0).max(100).optional(),
  maxAutoOptimizeRounds: z.number().int().min(0).max(10).optional(),
  promptId: z.string().nullish(),
  publish: z.boolean().optional(),
});

/** 规则列表(含全部版本;生效版本以 status=published 标识) */
export const GET = withAdmin<AdminRouteContext>(async () => {
  return json({ rules: listReviewRules() });
});

/** 新建规则(含首个版本,可选直接发布) */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const body = await readJson(req, createSchema);
  return json(createReviewRule(body), 201);
});
