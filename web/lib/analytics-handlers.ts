// V8 数据分析端点共享实现。
// 所有端点需要 admin 鉴权。

import type { NextRequest } from 'next/server';
import { getAnalyticsOverview, getBookFunnel, getBookChapterMetrics, getBookBySlug } from '@novel/core';
import { json, handleError, requireAdmin } from '@/lib/admin-api';

/** GET /api/admin/analytics/overview */
export function overviewGet(req: NextRequest): Response {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    return json(getAnalyticsOverview());
  } catch (err) {
    return handleError(err);
  }
}

/** GET /api/admin/analytics/books/[id] */
export function bookFunnelGet(req: NextRequest, bookId: string): Response {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    return json(getBookFunnel(bookId));
  } catch (err) {
    return handleError(err);
  }
}

/** GET /api/admin/analytics/books/[id]/chapters */
export function bookChaptersGet(req: NextRequest, bookId: string): Response {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    return json(getBookChapterMetrics(bookId));
  } catch (err) {
    return handleError(err);
  }
}
