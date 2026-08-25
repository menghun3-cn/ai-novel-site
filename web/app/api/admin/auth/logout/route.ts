import type { NextRequest } from 'next/server';
import { logoutAdmin } from '@novel/core';
import { json, getProvidedToken } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 登出:吊销当前会话;幂等 */
export async function POST(req: NextRequest) {
  logoutAdmin(getProvidedToken(req));
  return json({ ok: true });
}
