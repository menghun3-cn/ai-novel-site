import { createHash } from 'node:crypto';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { LruCache } from '@/lib/cache';

/**
 * Markdown → HTML(服务端渲染用)。
 *
 * 已发布章节正文在本仓库是「写成即不变」的热点数据:同一段 contentMd 重复渲染
 * 结果永远相同。这里用内容哈希做 key 缓存。因为 key 与内容绑定,章节被二次编辑
 * 保存后 contentMd 变化,哈希自然变成新的 → 缓存自动 miss → 重新渲染 → 无陈旧。
 * 因此「编辑后再发布,读者何时看到新内容」在这个层是零延迟,且不会返回旧内容。
 *
 * 大小上限 + TTL 兜底,防止罕见编辑导致无限的旧条目累积。
 */
const htmlCache = new LruCache<string, string>({ maxSize: 1000, ttlMs: 60 * 60 * 1000 });

function cacheKey(md: string): string {
  return createHash('sha256').update(md).digest('hex');
}

function renderSync(md: string): Promise<string> {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(md)
    .then((file) => String(file));
}

export async function mdToHtml(md: string): Promise<string> {
  const cached = htmlCache.get(cacheKey(md));
  if (cached !== undefined) return cached;

  const html = await renderSync(md);
  htmlCache.set(cacheKey(md), html);
  return html;
}
