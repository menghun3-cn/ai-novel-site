/** 章节标题展示:去掉正文 H1 自带的前缀,统一为「第N章 标题」 */
export function chapterLabel(number: number, title: string): string {
  const clean = title.replace(/^第[0-9一二三四五六七八九十百千零两]+章\s*/, '').trim();
  return clean ? `第${number}章 ${clean}` : `第${number}章`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
