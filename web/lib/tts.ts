/**
 * TTS 纯函数工具(TtsPlayer 共用,可在 Node 下单测)。
 * 移动端适配要点:
 * - 安卓 Chrome 对单条超长 SpeechSynthesisUtterance 会静音截断(约 15 秒),
 *   长段落必须按句切成小片;
 * - iOS Safari/WKWebView 的语音列表在首次 speak 之后才填充。
 */

/** 单片朗读时长预算(秒),留出安卓截断阈值的安全余量 */
const CHUNK_SECONDS_BUDGET = 12;
/** 中文语速估算(字/秒) */
const CHARS_PER_SECOND = 4.3;
export const MIN_CHUNK_LEN = 24;
export const MAX_CHUNK_LEN = 200;

/**
 * 按当前语速计算单片最大字符数:
 * 时长 ≈ 字数 / (字每秒 × 语速),预算固定时低速要缩短单片,
 * 否则 0.5× 语速下单片仍会超出安卓的时长截断。
 */
export function maxChunkLength(rate: number): number {
  const raw = Math.round(CHARS_PER_SECOND * CHUNK_SECONDS_BUDGET * Math.max(rate, 0.1));
  return Math.max(MIN_CHUNK_LEN, Math.min(MAX_CHUNK_LEN, raw));
}

/**
 * 把一段文本切成不超过 maxLen 的朗读片:
 * 优先在句末标点(。!?!?…;;换行)处断开,单句超长时硬切。
 */
export function splitIntoChunks(text: string, maxLen: number): string[] {
  const bounded = Math.max(1, Math.floor(maxLen));
  const sentences =
    text.match(/[^。！？!?…；;\n]*[。！？!?…；;\n]+|[^。！？!?…；;\n]+$/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim().length > 0) chunks.push(buf);
    buf = '';
  };
  for (const s of sentences) {
    if ((buf + s).length <= bounded) {
      buf += s;
      continue;
    }
    flush();
    if (s.length <= bounded) {
      buf = s;
      continue;
    }
    for (let i = 0; i < s.length; i += bounded) {
      const piece = s.slice(i, i + bounded);
      if (piece.trim().length > 0) chunks.push(piece);
    }
  }
  flush();
  return chunks;
}

/** iOS / iPadOS 检测:iPadOS 13+ 默认报告 Macintosh UA,需配合触点数判断 */
export function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true;
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}
