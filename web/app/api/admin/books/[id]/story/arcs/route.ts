import { z } from 'zod';
import { createArc, deleteArc, listArcs, updateArc } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(4000).optional(),
  startChapter: z.number().int().positive().nullish(),
  endChapter: z.number().int().positive().nullish(),
  status: z.enum(['planned', 'active', 'done']).optional(),
});

const patchSchema = z.object({
  arcId: z.number().int().positive(),
  title: z.string().min(1).max(120).optional(),
  summary: z.string().max(4000).optional(),
  startChapter: z.number().int().positive().nullish(),
  endChapter: z.number().int().positive().nullish(),
  status: z.enum(['planned', 'active', 'done']).optional(),
});

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ arcs: listArcs(id) });
});

export const POST = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, createSchema);
  return json({
    arc: createArc(id, {
      ...body,
      startChapter: body.startChapter ?? null,
      endChapter: body.endChapter ?? null,
    }),
  });
});

export const PUT = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, patchSchema);
  const { arcId, ...patch } = body;
  return json({
    arc: updateArc(id, arcId, {
      ...patch,
      startChapter: patch.startChapter ?? undefined,
      endChapter: patch.endChapter ?? undefined,
    }),
  });
});

export const DELETE = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const aid = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(aid) || aid <= 0) return json({ error: 'VALIDATION_FAILED', message: 'id required' }, 400);
  return json({ deleted: deleteArc(id, aid) });
});
