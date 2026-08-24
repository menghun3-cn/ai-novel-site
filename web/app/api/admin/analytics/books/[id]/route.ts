import type { NextRequest } from 'next/server';
import { bookFunnelGet } from '@/lib/analytics-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 单书漏斗分析 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return bookFunnelGet(req, id);
}
