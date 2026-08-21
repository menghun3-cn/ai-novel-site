/**
 * TXT 章节解析器（见方案 §6.2、§6.3）。
 *
 * - 单章节 TXT：按空行分段落。
 * - 整本 TXT：识别章节标题自动拆章；首个标题之前的内容视为「前言」。
 */
import type { RawChapter } from '../types.js';
import { escapeHtml } from '../util.js';
import { parseChapterHeading } from './heading.js';

const MAX_HEADING_LENGTH = 60;

/** 纯文本 → XHTML：按空行分段，段内换行转为 <br />。 */
export function txtToXhtml(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split(/\n[ \t]*\n+/);
  const parts = paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const lines = p
        .split('\n')
        .map((l) => escapeHtml(l.trim()))
        .filter((l) => l.length > 0);
      return `<p>${lines.join('<br />')}</p>`;
    });
  return parts.join('\n');
}

function makeChapter(title: string, content: string, sourceFile: string): RawChapter {
  return { title, content: content || '<p></p>', sourceFile };
}

/** 解析 TXT 文件：可能拆出 1 个或多个章节。 */
export function parseTxtChapters(
  content: string,
  sourceFile: string,
  fallbackTitle: string,
): RawChapter[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  interface Section {
    title: string;
    lines: string[];
  }

  const sections: Section[] = [];
  let current: Section | null = null;
  let preamble: string[] = [];
  let headingFound = false;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const heading =
      trimmed && trimmed.length <= MAX_HEADING_LENGTH ? parseChapterHeading(trimmed) : null;
    if (heading) {
      headingFound = true;
      if (current) sections.push(current);
      current = { title: heading.title, lines: [] };
    } else if (current) {
      current.lines.push(raw);
    } else {
      preamble.push(raw);
    }
  }
  if (current) sections.push(current);

  // 没有任何章节标题：整文件视为单章。
  if (!headingFound) {
    return [makeChapter(fallbackTitle, txtToXhtml(normalized), sourceFile)];
  }

  const chapters: RawChapter[] = [];
  const preambleText = preamble.join('\n').trim();
  const preambleLines = preambleText ? preambleText.split('\n').filter((l) => l.trim()).length : 0;
  // 仅当首段有实质内容（≥2 个非空行）时才作为「前言」章节，避免把书名行误判成章节。
  if (preambleLines >= 2) {
    chapters.push(makeChapter('前言', txtToXhtml(preambleText), sourceFile));
  }
  for (const s of sections) {
    chapters.push(makeChapter(s.title, txtToXhtml(s.lines.join('\n')), sourceFile));
  }
  return chapters;
}
