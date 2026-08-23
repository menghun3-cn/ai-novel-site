import type { NextRequest } from 'next/server';
import { subscribeToggle, subscribeState } from '@/lib/reader-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** 订阅状态查询 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  return subscribeState(req, slug);
}

/** 切换订阅 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  return subscribeToggle(req, slug);
}
