// 读者会话 Cookie 约定:httpOnly + SameSite=Lax;默认不设 Secure,
// 以兼容纯 HTTP 自托管部署(可用 READER_COOKIE_SECURE=1 打开)

import type { NextRequest, NextResponse } from 'next/server';
import { getSessionReader, type ReaderUser } from '@novel/core';

export const READER_COOKIE = 'reader_session';

export function applySessionCookie(res: NextResponse, token: string, expiresAt: string): void {
  res.cookies.set(READER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(expiresAt),
    secure: process.env.READER_COOKIE_SECURE === '1',
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(READER_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: process.env.READER_COOKIE_SECURE === '1',
  });
}

/** 当前登录读者;未登录返回 null(不抛错) */
export function currentReader(req: NextRequest): ReaderUser | null {
  try {
    return getSessionReader(req.cookies.get(READER_COOKIE)?.value);
  } catch {
    return null;
  }
}
