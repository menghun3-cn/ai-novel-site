import type { NextRequest } from 'next/server';
import { bookChaptersGet } from '@/lib/analytics-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 单书章节指标列表 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return bookChaptersGet(req, id);
}
