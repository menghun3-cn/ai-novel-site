import { rssItems } from '@novel/core';

export const dynamic = 'force-dynamic';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 去掉章节标题自带的前缀,如「第一章 余烬」→「余烬」 */
function cleanTitle(t: string): string {
  return t.replace(/^第[0-9一二三四五六七八九十百千零两]+章\s*/, '');
}

export async function GET() {
  const base = (process.env.NOVEL_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const items = rssItems(20);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>云燕阅读 - 最新章节</title>
<link>${base}</link>
<description>AI小说创作平台的最新章节更新</description>
<language>zh-CN</language>
<atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>
${items
  .map(
    (it) => `<item>
<title>${esc(it.bookTitle)} 第${it.chapterNumber}章 ${esc(cleanTitle(it.chapterTitle))}</title>
<link>${base}/books/${it.bookSlug}/chapter/${it.chapterNumber}</link>
<guid isPermaLink="false">${it.bookId}/ch${it.chapterNumber}</guid>
<pubDate>${new Date(it.publishedAt).toUTCString()}</pubDate>
</item>`
  )
  .join('\n')}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
