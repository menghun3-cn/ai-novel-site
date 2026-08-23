import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoreError, createChapter, listChapters } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const createSchema = z.object({
  number: z.number().int().positive().optional(),
  title: z.string().min(1).max(300),
  contentMd: z.string().min(1),
  slug: z.string().max(300).nullish(),
  status: z.enum(['draft', 'scheduled', 'published', 'hidden']).optional(),
  scheduledAt: z.string().datetime().nullish(),
});

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ chapters: listChapters(id) });
});

export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const input = await readJson(req, createSchema);
  if (input.number === undefined) {
    // 无 number 时走自动接排;先确认书存在以给出 404 而不是静默建到错误的书
    const { getAnyBookById } = await import('@novel/core');
    if (!getAnyBookById(id)) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${id}`);
  }
  const chapter = createChapter({
    bookId: id,
    number: input.number,
    title: input.title,
    contentMd: input.contentMd,
    slug: input.slug ?? null,
    status: input.status,
    scheduledAt: input.scheduledAt ?? null,
  });
  return json({ chapter }, 201);
});
