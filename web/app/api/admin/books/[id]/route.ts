import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { CoreError, deleteBook, getAnyBookById, updateBook } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).nullish(),
    coverPath: z.string().max(1000).nullish(),
    status: z.enum(['serializing', 'completed', 'hidden']),
    authorName: z.string().min(1).max(120),
    categoryName: z.string().min(1).max(120),
    tags: z.array(z.string().min(1).max(60)).max(30),
  })
  .partial();

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const book = getAnyBookById(id);
  if (!book) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${id}`);
  return json({ book });
});

export const PATCH = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const patch = await readJson(req, patchSchema);
  const book = updateBook(id, {
    ...patch,
    description: patch.description !== undefined ? (patch.description ?? null) : undefined,
    coverPath: patch.coverPath !== undefined ? (patch.coverPath ?? null) : undefined,
  });
  return json({ book });
});

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const ok = deleteBook(id);
  if (!ok) throw new CoreError('BOOK_NOT_FOUND', `book not found: ${id}`);
  return json({ deleted: true });
});
