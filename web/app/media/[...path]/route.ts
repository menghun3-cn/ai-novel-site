import { readMedia } from '@/lib/admin-media';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

/** 公开媒体服务:只允许单段文件名;SVG 附 sandbox CSP 防脚本注入 */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { path: segments } = await ctx.params;
  const media = readMedia(segments ?? []);
  if (!media) return new Response('Not Found', { status: 404 });
  return new Response(new Uint8Array(media.body), {
    headers: {
      'Content-Type': media.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
