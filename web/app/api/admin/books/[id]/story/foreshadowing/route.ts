import { z } from 'zod';
import { deleteForeshadowing, listForeshadowing, plantForeshadowing, resolveForeshadowing } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const plantSchema = z.object({
  label: z.string().min(1).max(120),
  detail: z.string().max(2000).optional(),
  plantedChapter: z.number().int().positive().nullish(),
});

const resolveSchema = z.object({
  foreshadowingId: z.number().int().positive(),
  resolvedChapter: z.number().int().positive(),
});

export const GET = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const openOnly = req.nextUrl.searchParams.get('openOnly') === '1';
  return json({ foreshadowing: listForeshadowing(id, { openOnly }) });
});

/** 埋设伏笔 */
export const POST = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, plantSchema);
  return json({ foreshadowing: plantForeshadowing(id, { ...body, plantedChapter: body.plantedChapter ?? null }) });
});

/** 回收伏笔(COALESCE 幂等,保留首次回收章号) */
export const PUT = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, resolveSchema);
  return json({ foreshadowing: resolveForeshadowing(id, body.foreshadowingId, body.resolvedChapter) });
});

export const DELETE = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const fid = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(fid) || fid <= 0) return json({ error: 'VALIDATION_FAILED', message: 'id required' }, 400);
  return json({ deleted: deleteForeshadowing(id, fid) });
});
