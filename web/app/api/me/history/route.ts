import type { NextRequest } from 'next/server';
import { historyList } from '@/lib/reader-handlers';

export const dynamic = 'force-dynamic';

/** 阅读历史(最近阅读,倒序) */
export async function GET(req: NextRequest) {
  return historyList(req);
}
