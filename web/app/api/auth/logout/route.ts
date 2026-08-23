import { NextResponse, type NextRequest } from 'next/server';
import { logoutReader } from '@novel/core';
import { clearSessionCookie, READER_COOKIE } from '@/lib/reader-auth';

export const dynamic = 'force-dynamic';

/** 登出:删除服务端会话并清 Cookie(幂等) */
export async function POST(req: NextRequest) {
  logoutReader(req.cookies.get(READER_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
