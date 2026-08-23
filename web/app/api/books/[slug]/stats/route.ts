import type { NextRequest } from 'next/server';
import { statsGet } from '@/lib/discovery-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/** 书籍热度统计(PV/收藏/完读率) */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  return statsGet(req, slug);
}
