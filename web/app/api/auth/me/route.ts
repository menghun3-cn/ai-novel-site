import { NextResponse, type NextRequest } from 'next/server';
import { currentReader } from '@/lib/reader-auth';

export const dynamic = 'force-dynamic';

/** 当前登录读者;未登录返回 { user: null }(恒 200,便于前端探测) */
export async function GET(req: NextRequest) {
  return NextResponse.json({ user: currentReader(req) });
}
