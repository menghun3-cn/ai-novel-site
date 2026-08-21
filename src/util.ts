/**
 * 通用工具函数：哈希、XML/HTML 转义、中文数字转换、自然排序等。
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

/** SHA-256（hex）。 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 对文件内容计算 SHA-256（hex）。 */
export async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** 依据名称生成稳定的 UUID v5（同名书籍在多次构建间保持稳定标识）。 */
export function uuidV5(name: string, namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name, 'utf8').digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 转义 XML/HTML 文本中的特殊字符。 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 转义 HTML 文本内容（供纯文本转 XHTML 用）。 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 当前时间 ISO 8601（UTC）。 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 将 ISO 时间去除毫秒，用于 dcterms:modified。 */
export function toModifiedIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 中文数字转阿拉伯数字，如 "一百零五" -> 105。无法解析返回 null。 */
export function cnToNumber(input: string): number | null {
  if (!input) return null;
  let result = 0;
  let section = 0;
  let current = 0;
  for (const ch of input) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
    } else if (ch === '十' || ch === '百' || ch === '千') {
      const unit = ch === '十' ? 10 : ch === '百' ? 100 : 1000;
      if (current === 0) current = 1;
      section += current * unit;
      current = 0;
    } else if (ch === '万') {
      section = (section + current) * 10000;
      result += section;
      section = 0;
      current = 0;
    } else if (ch === '亿') {
      section = (section + current) * 100000000;
      result += section;
      section = 0;
      current = 0;
    } else {
      return null;
    }
  }
  return result + section + current;
}

/** 解析章节序号：阿拉伯数字或中文数字，失败返回 null。 */
export function parseNumeral(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isSafeInteger(n) ? n : null;
  }
  return cnToNumber(trimmed);
}

/** 文件名自然排序：优先比较数字前缀，否则按字符串。 */
export function naturalCompare(a: string, b: string): number {
  const na = a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
  if (na !== 0) return na;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 清理文件名中 Windows/跨平台非法字符。 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  return cleaned || 'untitled';
}

/** 判断文件是否存在且为普通文件。 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/** 简单的睡眠工具。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
