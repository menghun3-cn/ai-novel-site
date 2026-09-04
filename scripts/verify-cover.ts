/**
 * 动态封面验证:题材主题选择 + SVG 渲染 + coverSrc 兜底 URL + /api/covers 路由。
 * 运行:npm run test:cover
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-cover-'));

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed++;
}

const { renderCoverSvg, renderCoverIconSvg, pickTheme, coverSrc, coverIconSrc } = await import('../web/lib/cover-svg');

// ---------- 主题选择 ----------
{
  assertOk(pickTheme('治愈短篇').id === 'heal', '治愈 → heal 主题');
  assertOk(pickTheme('科幻').id === 'scifi', '科幻 → scifi 主题');
  assertOk(pickTheme('仙侠').id === 'xianxia', '仙侠 → xianxia 主题');
  assertOk(pickTheme('悬疑推理').id === 'mystery', '悬疑推理 → mystery 主题');
  assertOk(pickTheme('都市言情').id === 'romance', '都市言情 → romance 主题');
  assertOk(pickTheme('职场').id === 'urban', '职场 → urban 主题');
  assertOk(pickTheme('青春校园').id === 'campus', '青春校园 → campus 主题');
  assertOk(pickTheme('历史').id === 'history', '历史 → history 主题');
  assertOk(pickTheme('冒险').id === 'adventure', '冒险 → adventure 主题');
  assertOk(pickTheme('某自定义题材').id === 'default', '未命中 → default 主题');
}

// ---------- SVG 渲染 ----------
{
  const svg = renderCoverSvg({
    title: '雨夜的旧窗',
    author: '林晚',
    category: '治愈',
    status: 'serializing',
    kind: 'short',
    chapterCount: 1,
  });
  assertOk(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'SVG 根元素完整');
  // 竖排书名:每字独立 tspan,按字校验
  assertOk(['雨', '夜', '旧', '窗'].every((c) => svg.includes(c)), '竖排书名逐字入 SVG');
  assertOk(['林', '晚'].every((c) => svg.includes(c)), '作者逐字入 SVG');
  assertOk(svg.includes('治愈'), '分类入 SVG');
  assertOk(svg.includes('短篇'), '短篇状态徽标入 SVG');
  assertOk(svg.includes('治愈短篇 · 共1章'), '页脚文案(治愈短篇 · 共1章)入 SVG');
  assertOk(svg.includes('url(#shadow)') && svg.includes('filter="url(#wc)"'), '阴影/水彩滤镜就位');

  const serializing = renderCoverSvg({ title: '连载之书', author: '作者', category: '科幻', status: 'serializing', kind: 'long', chapterCount: 5 });
  assertOk(serializing.includes('连载中'), '长篇连载状态徽标入 SVG');

  const completed = renderCoverSvg({ title: '完结之书', author: '作者', category: '科幻', status: 'completed', kind: 'long', chapterCount: 120 });
  assertOk(completed.includes('完结') && completed.includes('科幻 · 共120章'), '长篇完结页脚正确');

  const hidden = renderCoverSvg({ title: '藏', author: 'a', category: '悬疑', status: 'hidden', kind: 'short', chapterCount: 0 });
  assertOk(!hidden.includes('连载中'), 'hidden 状态不显示连载中徽标');
}

// ---------- XML 转义 ----------
{
  const svg = renderCoverSvg({
    title: 'A&B<C>"D"',
    author: 'O\'Neil',
    category: '都市',
    status: 'serializing',
    kind: 'long',
    chapterCount: 3,
  });
  assertOk(svg.includes('A&amp;B&lt;C&gt;'), '书名 XML 转义(& < >)');
  assertOk(svg.includes('&quot;D&quot;'), '书名引号转义为 &quot;');
  assertOk(!svg.includes('A&B<C>'), 'SVG 不含裸 & < > 文本');
  assertOk(svg.includes('&apos;'), '作者单引号转义为 &apos;');
}

// ---------- 小图标变体(48×48) ----------
{
  const icon = renderCoverIconSvg({ title: '雨夜的旧窗', author: '林晚', category: '治愈', status: 'serializing', kind: 'short', chapterCount: 1 });
  assertOk(icon.startsWith('<svg') && icon.includes('viewBox="0 0 48 48"'), '图标 SVG 为 48×48 viewBox');
  assertOk(icon.includes('治愈'), '图标含分类字(治愈)');
  assertOk(icon.includes('M 24 12 Q 28 20 24 26'), '治愈主题雨滴母题入图标');
  assertOk(icon.includes('rx="8"'), '图标含圆角底板');

  const scifiIcon = renderCoverIconSvg({ title: '星海', author: 'a', category: '科幻', status: 'completed', kind: 'long', chapterCount: 10 });
  assertOk(scifiIcon.includes('rx="8"') && scifiIcon.includes('科幻'), '科幻图标含底板与分类字');
  assertOk(!scifiIcon.includes('M 24 12 Q 28 20'), '科幻图标不带治愈雨滴母题');

  const latin = renderCoverIconSvg({ title: 'X', author: 'b', category: '某自定义', status: 'completed', kind: 'long', chapterCount: 2 });
  assertOk(latin.includes('文学') || latin.includes('某自定义'), '未命中题材图标回退默认分类字');
}

// ---------- coverSrc 兜底 URL ----------
{
  assertOk(coverSrc({ slug: 'x', coverPath: null }) === '/api/covers/x', '无封面 → /api/covers/[slug]');
  assertOk(coverIconSrc({ slug: 'x', coverPath: null }) === '/api/covers/x?s=icon', '无封面小图标 → /api/covers/[slug]?s=icon');
  assertOk(coverSrc({ slug: 'x', coverPath: 'covers/a.png' }) === '/covers/a.png', '相对封面路径补前导斜杠');
  assertOk(coverIconSrc({ slug: 'x', coverPath: '/media/a.png' }) === '/media/a.png', '有封面小图标回原图');
}

// ---------- 路由 ----------
{
  const core = await import('@novel/core');
  const { createBook, createChapter, submitChapterForReview, approveChapter, updateBook } = core;
  const noCover = createBook({ slug: 'cov-no-cover', title: '无封面书', authorName: '测', categoryName: '科幻', tags: [] });
  createChapter({ bookId: noCover.id, number: 1, title: '第1章', contentMd: '# 第1章\n\n正文' });
  submitChapterForReview(noCover.id, 1);
  approveChapter(noCover.id, 1, { mode: 'now' });

  const withCover = createBook({ slug: 'cov-with-cover', title: '有封面书', authorName: '测', categoryName: '治愈', coverPath: '/media/cover.png', tags: [] });

  const { GET } = await import('../web/app/api/covers/[slug]/route');

  const gen = await GET(new Request('http://localhost/api/covers/cov-no-cover'), {
    params: Promise.resolve({ slug: 'cov-no-cover' }),
  });
  assertOk(gen.status === 200 && gen.headers.get('content-type')?.includes('image/svg+xml'), '无封面书 → 200 image/svg+xml');
  const body = await gen.text();
  assertOk(body.includes('无') && body.includes('书') && body.includes('科幻'), '生成 SVG 含书名逐字/分类');

  const icon = await GET(new Request('http://localhost/api/covers/cov-no-cover?s=icon'), {
    params: Promise.resolve({ slug: 'cov-no-cover' }),
  });
  assertOk(icon.status === 200 && icon.headers.get('content-type')?.includes('image/svg+xml'), '?s=icon → 200 image/svg+xml');
  const iconBody = await icon.text();
  assertOk(iconBody.includes('viewBox="0 0 48 48"') && iconBody.includes('科幻'), '图标 SVG 为 48×48 且含分类字');

  const redirect = await GET(new Request('http://localhost/api/covers/cov-with-cover'), {
    params: Promise.resolve({ slug: 'cov-with-cover' }),
  });
  assertOk(redirect.status === 307 && redirect.headers.get('location') === '/media/cover.png', '有封面书 → 307 到原图');

  const missing = await GET(new Request('http://localhost/api/covers/not-exist'), {
    params: Promise.resolve({ slug: 'not-exist' }),
  });
  assertOk(missing.status === 404, '不存在 slug → 404');

  updateBook(noCover.id, { status: 'hidden' });
  const hiddenRes = await GET(new Request('http://localhost/api/covers/cov-no-cover'), {
    params: Promise.resolve({ slug: 'cov-no-cover' }),
  });
  assertOk(hiddenRes.status === 404, '隐藏书 → 404(与公开可见性一致)');
}

console.log(failed === 0 ? '\n动态封面全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
