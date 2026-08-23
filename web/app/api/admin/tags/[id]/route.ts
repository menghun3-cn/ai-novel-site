import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoreError, deleteTag, getTag, updateTag } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ name: z.string().min(1).max(60) });

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CoreError('TAG_NOT_FOUND', `invalid tag id: ${raw}`);
  }
  return n;
}

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const tag = getTag(parseId(id));
  if (!tag) throw new CoreError('TAG_NOT_FOUND', `tag not found: ${id}`);
  return json({ tag });
});

export const PATCH = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  return json({ tag: updateTag(parseId(id), patch) });
});

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteTag(parseId(id));
  return json({ deleted: true });
});
