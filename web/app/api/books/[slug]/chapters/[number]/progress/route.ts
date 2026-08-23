import type { NextRequest } from 'next/server';
import { progressReport } from '@/lib/reader-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; number: string }> };

/** 上报阅读进度 {percent} */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug, number } = await ctx.params;
  return progressReport(req, slug, Number(number));
}
