import { getBookBySlug } from '@novel/core';
import { renderCoverSvg, renderCoverIconSvg } from '@/lib/cover-svg';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * 动态封面:GET /api/covers/[slug] 或 ?s=icon
 * - 有上传封面 → 307 重定向到原图(读者站已有封面一律走原图);
 * - 无封面 → 按分类/题材渲染书本形 SVG 封面(默认)或 48×48 小图标(?s=icon);
 * - 隐藏/不存在 → 404(与公开可见性口径一致)。
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const { slug } = await ctx.params;
  const book = getBookBySlug(slug);
  if (!book) return new Response('Not Found', { status: 404 });

  if (book.coverPath) {
    const target = book.coverPath.startsWith('/') ? book.coverPath : `/${book.coverPath}`;
    return new Response(null, { status: 307, headers: { Location: target } });
  }

  const isIcon = new URL(req.url).searchParams.get('s') === 'icon';
  const input = {
    title: book.title,
    author: book.authorName,
    category: book.categoryName,
    status: book.status,
    kind: book.kind,
    chapterCount: book.publishedCount,
  };
  const svg = isIcon ? renderCoverIconSvg(input) : renderCoverSvg(input);

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
