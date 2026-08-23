import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createCategory, listCategories } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({ name: z.string().min(1).max(120) });

export const GET = withAdmin(async () => json({ categories: listCategories() }));

export const POST = withAdmin(async (req: NextRequest) => {
  const { name } = await readJson(req, createSchema);
  return json({ category: createCategory(name) }, 201);
});
