/**
 * 章节标题识别（见方案 §6.3、§7）。
 *
 * 支持：
 *   - 第X章 / 第一章 / 第001章 / 第X回 / 第X节 / 第X卷 / 第X集 / 第X部 / 第X篇 / 第X话
 *   - 序章、序言、楔子、引子、引言、前言、序幕、终章、尾声、后记、外传、番外、附录、特别篇、正篇
 */
import { parseNumeral } from '../util.js';

export interface Heading {
  /** 从序号解析出的顺序（仅带数字的标题有值）。 */
  order?: number;
  /** 完整标题文本。 */
  title: string;
}

const MAX_HEADING_LENGTH = 60;
// 标题后跟的分隔符集合（空格、冒号、顿号、破折号等）。
const SEPARATOR_RE = /^[\s：:、，,。．.·\-—–~～!！?？…]/;

export function parseChapterHeading(line: string): Heading | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) return null;

  // 带序号标题：第X章 / 第X回 / ...
  const numbered = trimmed.match(/^第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*[章回节卷集部篇话](.*)$/);
  if (numbered) {
    const rest = numbered[2] ?? '';
    if (rest !== '' && !SEPARATOR_RE.test(rest)) {
      // 形如 "第一章的内容很重要" 是正文，不是标题。
      return null;
    }
    return { order: parseNumeral(numbered[1]) ?? undefined, title: trimmed };
  }

  // 命名标题：序章 / 楔子 / 尾声 / 番外 / 附录 ...
  const named = trimmed.match(/^(序章|序言|楔子|引子|引言|前言|序幕|终章|尾声|后记|外传|番外|附录|特别篇|正篇)(.*)$/);
  if (named) {
    const rest = named[2] ?? '';
    if (rest !== '' && !SEPARATOR_RE.test(rest)) {
      return null;
    }
    return { title: trimmed };
  }

  return null;
}
