import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteProductionLine, getProductionLine, listProductionRuns, updateProductionLine } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
  config: z.unknown().optional(),
  maxConsecutiveFailures: z.number().int().min(1).max(20).optional(),
});

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const line = getProductionLine(id);
  return json({ line, runs: listProductionRuns({ lineId: id, limit: 50 }) });
});

export const PUT = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  return json({ line: updateProductionLine(id, patch) });
});

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteProductionLine(id);
  return json({ deleted: true });
});
