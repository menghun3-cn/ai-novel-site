// 管理 API 共享层:鉴权、JSON 响应、CoreError→HTTP 映射、zod 请求体解析
// 鉴权模型(V2):环境变量 ADMIN_TOKEN + Bearer/x-admin-token 头;未配置则 API 整体停用
// 完整用户系统属 V6;API 面向后台 UI 与未来的 Hermes/AI 引擎集成

import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { CoreError, type CoreErrorCode } from '@novel/core';
import { MediaError } from '@/lib/admin-media';
import type { ZodType } from 'zod';

export const ADMIN_TOKEN_HEADER = 'x-admin-token';

/** 定长摘要后比较:不泄露长度、时序安全 */
function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data as Record<string, unknown>, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function fail(status: number, code: string, message?: string): Response {
  return json({ error: code, message: message ?? null }, status);
}

/** 返回 null 表示通过;否则直接作为响应返回 */
export function requireAdmin(req: NextRequest): Response | null {
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) return fail(503, 'ADMIN_API_DISABLED', 'ADMIN_TOKEN is not configured');
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.headers.get(ADMIN_TOKEN_HEADER) ??
    '';
  if (!provided || !safeEqual(provided, configured)) return fail(401, 'UNAUTHORIZED');
  return null;
}

const STATUS_BY_CODE: Record<CoreErrorCode, number> = {
  BOOK_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  CHAPTER_NOT_FOUND: 404,
  CHAPTER_NUMBER_CONFLICT: 409,
  INVALID_CHAPTER_ORDER: 400,
  INVALID_STATUS: 400,
  AUTHOR_NOT_FOUND: 404,
  AUTHOR_NAME_TAKEN: 409,
  AUTHOR_IN_USE: 409,
  CATEGORY_NOT_FOUND: 404,
  CATEGORY_NAME_TAKEN: 409,
  CATEGORY_IN_USE: 409,
  TAG_NOT_FOUND: 404,
  TAG_NAME_TAKEN: 409,
};

/** 统一把服务层异常翻译为 HTTP;未知错误一律 500 且不泄露内部信息 */
export function handleError(err: unknown): Response {
  if (err instanceof CoreError) {
    return fail(STATUS_BY_CODE[err.code] ?? 400, err.code, err.message);
  }
  if (err instanceof MediaError) {
    return fail(err.status, err.code, err.message);
  }
  console.error('[admin-api]', err);
  return fail(500, 'INTERNAL_ERROR');
}

/** 解析并校验 JSON 请求体;失败抛出可被 catch 的 Response 标记 */
export class BadRequest extends Error {
  constructor(
    public readonly response: Response
  ) {
    super('bad request');
  }
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new BadRequest(fail(400, 'INVALID_JSON'));
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequest(fail(400, 'VALIDATION_FAILED', parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')));
  }
  return parsed.data;
}

/** 路由处理统一包装:鉴权 → 业务 → 错误映射(ctx 泛型兼容动态路由) */
export function withAdmin<C = undefined>(
  fn: (req: NextRequest, ctx: C) => Promise<Response>
): (req: NextRequest, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const denied = requireAdmin(req);
    if (denied) return denied;
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof BadRequest) return err.response;
      return handleError(err);
    }
  };
}

/** 解析动态段中的正整数章号 */
export function intParam(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BadRequest(fail(400, 'INVALID_PARAM', `${label} must be a positive integer`));
  }
  return n;
}

/** 可选整数查询参数 */
export function intQuery(sp: URLSearchParams, key: string): number | undefined {
  const raw = sp.get(key);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
