import type { NextRequest } from 'next/server';
import { finishReport } from '@/lib/discovery-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; number: string }> };

/** 记录章节完读 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug, number } = await ctx.params;
  return finishReport(req, slug, Number(number));
}
