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

/**
 * 内容寻址缓存键:确定性纯 JS 哈希(双通道 FNV-1a,共 64 位)。
 *
 * 不用 node:crypto 的原因:本模块同时被服务端页面和客户端组件
 * (admin 渲染预览)引用;`node:` scheme 在客户端 webpack 打包时
 * 会报 UnhandledSchemeError。FNV-1a 无密码学强度要求,64 位对
 * ≤1000 条 LRU 条目碰撞概率可忽略,且跨环境确定性一致。
 */
function hash32(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function cacheKey(md: string): string {
  const a = hash32(md, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = hash32(md, 0x9e3779b9).toString(16).padStart(8, '0');
  return a + b;
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
