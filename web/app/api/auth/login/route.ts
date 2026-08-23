import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { loginReader } from '@novel/core';
import { handleError } from '@/lib/admin-api';
import { applySessionCookie } from '@/lib/reader-auth';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  login: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(128),
});

/** 读者登录(用户名或邮箱);成功建立会话 Cookie */
export async function POST(req: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
    }
    const session = loginReader(parsed.data);
    const res = NextResponse.json({ user: session.user, expiresAt: session.expiresAt });
    applySessionCookie(res, session.token, session.expiresAt);
    return res;
  } catch (err) {
    return handleError(err);
  }
}
