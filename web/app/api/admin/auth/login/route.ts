import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { loginAdmin } from '@novel/core';
import { BadRequest, handleError, json, readJson } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

/**
 * 管理员登录:校验账号口令,返回会话令牌与 mustChangePassword 标记。
 * 初始账号 admin/Admin@123456;mustChangePassword=true 时前端跳转强制改密页,
 * 且服务端在改密前拒绝一切业务 API(403 PASSWORD_CHANGE_REQUIRED)。
 */
export async function POST(req: NextRequest) {
  try {
    const input = await readJson(req, bodySchema);
    return json(loginAdmin(input));
  } catch (err) {
    if (err instanceof BadRequest) return err.response;
    return handleError(err);
  }
}
