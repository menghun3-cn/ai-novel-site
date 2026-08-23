import type { NextRequest } from 'next/server';
import { fail, json, withAdmin } from '@/lib/admin-api';
import { deleteMedia } from '@/lib/admin-media';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ name: string }> };

export const DELETE = withAdmin<Ctx>(async (_req, ctx) => {
  const { name } = await ctx.params;
  const ok = deleteMedia(name);
  if (!ok) return fail(404, 'MEDIA_NOT_FOUND', `media not found: ${name}`);
  return json({ deleted: true });
});
