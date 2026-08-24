import type { NextRequest } from 'next/server';
import { overviewGet } from '@/lib/analytics-handlers';

export const dynamic = 'force-dynamic';

/** 平台运营总览 */
export async function GET(req: NextRequest) {
  return overviewGet(req);
}
