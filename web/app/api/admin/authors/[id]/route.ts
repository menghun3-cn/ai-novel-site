import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoreError, deleteAuthor, getAuthor, updateAuthor } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().min(1).max(120),
    bio: z.string().max(3000).nullish(),
    avatarPath: z.string().max(1000).nullish(),
  })
  .partial();

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CoreError('AUTHOR_NOT_FOUND', `invalid author id: ${raw}`);
  }
  return n;
}

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const author = getAuthor(parseId(id));
  if (!author) throw new CoreError('AUTHOR_NOT_FOUND', `author not found: ${id}`);
  return json({ author });
});

export const PATCH = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  const author = updateAuthor(
    parseId(id),
    patch.bio !== undefined || patch.avatarPath !== undefined
      ? { ...patch, bio: patch.bio ?? null, avatarPath: patch.avatarPath ?? null }
      : patch
  );
  return json({ author });
});

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  deleteAuthor(parseId(id));
  return json({ deleted: true });
});
