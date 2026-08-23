import type { NextRequest } from 'next/server';
import { shelfList } from '@/lib/reader-handlers';

export const dynamic = 'force-dynamic';

/** 我的书架(收藏∪订阅,含进度与更新提示) */
export async function GET(req: NextRequest) {
  return shelfList(req);
}
