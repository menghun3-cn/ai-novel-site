import type { NextRequest } from 'next/server';
import { favoriteToggle, favoriteState } from '@/lib/reader-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** 收藏状态查询 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  return favoriteState(req, slug);
}

/** 切换收藏 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  return favoriteToggle(req, slug);
}
