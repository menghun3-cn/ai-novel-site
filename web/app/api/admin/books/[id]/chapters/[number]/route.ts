import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoreError, deleteChapter, getChapterByNumber, updateChapter } from '@novel/core';
import { intParam, json, readJson, withAdmin } from '@/lib/admin-api';
import { revalidateBookChapter } from '@/lib/revalidate';

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
  const n = intParam(number, 'number');
  const patch = await readJson(req, patchSchema);
  const chapter = updateChapter(id, n, {
    ...patch,
    slug: patch.slug !== undefined ? (patch.slug ?? null) : undefined,
    scheduledAt: patch.scheduledAt !== undefined ? (patch.scheduledAt ?? null) : undefined,
  });
  // 二次编辑已发布章节:让读者下次访问即见新内容(章节页 + 书详情页)
  revalidateBookChapter(id, n);
  return json({ chapter });
});

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id, number } = await ctx.params;
  const n = intParam(number, 'number');
  const ok = deleteChapter(id, n);
  if (!ok) throw new CoreError('CHAPTER_NOT_FOUND', `${id} chapter ${number}`);
  // 删除章节会影响书详情(章节列表)与相邻章的上/下章链接
  revalidateBookChapter(id, n);
  return json({ deleted: true });
});
