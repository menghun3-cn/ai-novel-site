import { z } from 'zod';
import { deleteOutline, listOutlines, setOutline } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const putSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(120).optional(),
  beats: z.string().max(10000).optional(),
});

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ outlines: listOutlines(id) });
});

/** 按章号 upsert 大纲 */
export const PUT = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, putSchema);
  return json({ outline: setOutline(id, body) });
});

export const DELETE = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const n = Number(req.nextUrl.searchParams.get('number'));
  if (!Number.isInteger(n) || n <= 0) return json({ error: 'VALIDATION_FAILED', message: 'number required' }, 400);
  return json({ deleted: deleteOutline(id, n) });
});
