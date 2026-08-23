import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { reorderChapters } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const orderSchema = z.object({
  order: z.array(z.number().int().positive()).max(100000),
});

/** 整卷重排:order 必须是现有章号的一个排列 */
export const PUT = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const { order } = await readJson(req, orderSchema);
  const chapters = reorderChapters(id, order);
  return json({ chapters });
});
