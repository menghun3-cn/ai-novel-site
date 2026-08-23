import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createTag, listTags } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({ name: z.string().min(1).max(60) });

export const GET = withAdmin(async () => json({ tags: listTags() }));

export const POST = withAdmin(async (req: NextRequest) => {
  const { name } = await readJson(req, createSchema);
  return json({ tag: createTag(name) }, 201);
});
