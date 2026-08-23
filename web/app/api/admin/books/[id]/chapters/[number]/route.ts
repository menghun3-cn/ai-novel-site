import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoreError, deleteChapter, getChapterByNumber, updateChapter } from '@novel/core';
import { intParam, json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; number: string }> };

const patchSchema = z
  .object({
    title: z.string().min(1).max(300),
    contentMd: z.string().min(1),
    slug: z.string().max(300).nullish(),
    status: z.enum(['draft', 'pending_review', 'scheduled', 'published', 'hidden']),
    scheduledAt: z.string().datetime().nullish(),
  })
  .partial();

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id, number } = await ctx.params;
  const chapter = getChapterByNumber(id, intParam(number, 'number'));
  if (!chapter) throw new CoreError('CHAPTER_NOT_FOUND', `${id} chapter ${number}`);
  return json({ chapter });
});

export const PATCH = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id, number } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  const chapter = updateChapter(id, intParam(number, 'number'), {
    ...patch,
    slug: patch.slug !== undefined ? (patch.slug ?? null) : undefined,
    scheduledAt: patch.scheduledAt !== undefined ? (patch.scheduledAt ?? null) : undefined,
  });
  return json({ chapter });
});

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id, number } = await ctx.params;
  const ok = deleteChapter(id, intParam(number, 'number'));
  if (!ok) throw new CoreError('CHAPTER_NOT_FOUND', `${id} chapter ${number}`);
  return json({ deleted: true });
});
