import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { changeAdminPassword } from '@novel/core';
import { BadRequest, getProvidedToken, handleError, json, readJson } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

/**
 * 修改口令:须携带有效会话;校验当前口令与新口令复杂度
 * (≥10 位,含大小写/数字/特殊字符,不含用户名)。
 * 成功后清除 must_change_password 并吊销其余会话;本会话保持登录。
 */
export async function POST(req: NextRequest) {
  try {
    const input = await readJson(req, bodySchema);
    const account = changeAdminPassword({ token: getProvidedToken(req), ...input });
    return json(account);
  } catch (err) {
    if (err instanceof BadRequest) return err.response;
    return handleError(err);
  }
}
