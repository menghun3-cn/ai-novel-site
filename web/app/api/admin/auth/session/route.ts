import type { NextRequest } from 'next/server';
import { getAdminAccount } from '@novel/core';
import { getProvidedToken, handleError, json } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

/** 当前管理员会话状态(用户名 + 是否首登待改密);无效/过期 → 401 */
export async function GET(req: NextRequest) {
  try {
    return json(getAdminAccount(getProvidedToken(req)));
  } catch (err) {
    return handleError(err);
  }
}
