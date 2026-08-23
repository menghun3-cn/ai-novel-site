import type { NextRequest } from 'next/server';
import { discoveryGet } from '@/lib/discovery-handlers';

export const dynamic = 'force-dynamic';

/** Discovery 各板块;登录读者附 猜你喜欢 */
export async function GET(req: NextRequest) {
  return discoveryGet(req);
}
