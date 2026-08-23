import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoreError, deleteCategory, getCategory, updateCategory } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ name: z.string().min(1).max(120) });

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CoreError('CATEGORY_NOT_FOUND', `invalid category id: ${raw}`);
  }
  return n;
}

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const category = getCategory(parseId(id));
  if (!category) throw new CoreError('CATEGORY_NOT_FOUND', `category not found: ${id}`);
  return json({ category });
});

export const PATCH = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  return json({ category: updateCategory(parseId(id), patch) });
});

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteCategory(parseId(id));
  return json({ deleted: true });
});
