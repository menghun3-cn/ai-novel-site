import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { registerReader } from '@novel/core';
import { handleError } from '@/lib/admin-api';
import { applySessionCookie } from '@/lib/reader-auth';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  username: z.string().trim().min(2).max(24),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(128),
});

/** 读者注册;成功即建立会话 Cookie */
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
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        { status: 400 }
      );
    }
    const session = registerReader(parsed.data);
    const res = NextResponse.json({ user: session.user, expiresAt: session.expiresAt });
    applySessionCookie(res, session.token, session.expiresAt);
    return res;
  } catch (err) {
    return handleError(err);
  }
}
