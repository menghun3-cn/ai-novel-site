import type { NextRequest } from 'next/server';
import { viewReport } from '@/lib/discovery-handlers';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string; number: string }> };

/** 记录章节 PV */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug, number } = await ctx.params;
  return viewReport(req, slug, Number(number));
}
