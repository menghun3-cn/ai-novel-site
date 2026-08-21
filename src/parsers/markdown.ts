/**
 * Markdown 章节解析器（见方案 §6.1）。
 *
 * 单个 .md 文件对应一个章节；第一个一级标题作为章节标题，
 * 其余内容通过 remark/rehype 转换为 XHTML。
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import type { RawChapter } from '../types.js';

const mdProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify, { allowDangerousHtml: false });

/** 将 HTML5 序列化结果修正为 XHTML（自闭合 void 元素、布尔属性）。 */
function htmlToXhtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '<br />')
    .replace(/<hr\s*\/?>/gi, '<hr />')
    .replace(/<img\s+([^>]*?)\s*\/?>/gi, '<img $1 />')
    .replace(/<input\s+([^>]*?)\s*\/?>/gi, '<input $1 />')
    .replace(/(\s)(checked|disabled|selected|required|multiple|readonly)(?=[\s/>])/g, '$1$2="$2"');
}

/** Markdown → XHTML 片段。 */
export function mdToXhtml(markdown: string): string {
  const html = String(mdProcessor.processSync(markdown));
  return htmlToXhtml(html);
}

/** 解析单个 Markdown 章节文件。 */
export function parseMarkdownChapter(
  content: string,
  sourceFile: string,
  fallbackTitle: string,
): RawChapter {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let title = fallbackTitle;
  let body = normalized;

  // 提取第一个一级标题作为章节标题。
  const heading = normalized.match(/^#\s+(.+)$/m);
  if (heading) {
    title = heading[1].trim();
    body = normalized.replace(/^#\s+.*(?:\r?\n|$)/m, '');
  }

  const html = mdToXhtml(body.trim());
  return {
    title,
    content: html.trim() || '<p></p>',
    sourceFile,
  };
}
