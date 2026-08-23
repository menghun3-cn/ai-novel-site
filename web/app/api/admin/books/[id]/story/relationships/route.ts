import { z } from 'zod';
import { addRelationship, deleteRelationship, listRelationships } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  fromName: z.string().min(1).max(60),
  toName: z.string().min(1).max(60),
  kind: z.string().min(1).max(40),
  note: z.string().max(500).optional(),
});

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ relationships: listRelationships(id) });
});

export const POST = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, bodySchema);
  return json({ relationship: addRelationship(id, body) });
});

export const DELETE = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const rid = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(rid) || rid <= 0) return json({ error: 'VALIDATION_FAILED', message: 'id required' }, 400);
  return json({ deleted: deleteRelationship(id, rid) });
});
