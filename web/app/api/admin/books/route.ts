import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createBook, listAllBooks, type BookStatus } from '@novel/core';
import { AdminRouteContext, intQuery, json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits and dashes'),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).nullish(),
  coverPath: z.string().max(1000).nullish(),
  status: z.enum(['serializing', 'completed', 'hidden']).optional(),
  authorName: z.string().min(1).max(120),
  categoryName: z.string().min(1).max(120),
  tags: z.array(z.string().min(1).max(60)).max(30).optional(),
});

export const GET = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const books = listAllBooks({
    status: (sp.get('status') ?? undefined) as BookStatus | undefined,
    categorySlug: sp.get('category') ?? undefined,
    q: sp.get('q') ?? undefined,
    limit: intQuery(sp, 'limit'),
    offset: intQuery(sp, 'offset'),
  });
  return json({ books });
});

export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  const input = await readJson(req, createSchema);
  const book = createBook({
    ...input,
    description: input.description ?? null,
    coverPath: input.coverPath ?? null,
    tags: input.tags ?? [],
  });
  return json({ book }, 201);
});
