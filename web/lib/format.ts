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

/**
 * 中国时区(UTC+8,无夏令时)时间展示。
 * 服务端落库的是 UTC ISO 串,直接 slice 会把北京时间显示成凌晨(差 8 小时),
 * 这里显式 +8 后用 UTC 取值,任何浏览器/服务器环境下都渲染同一份北京时间。
 */
export function formatChinaTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const c = new Date(d.getTime() + 8 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())} ${pad(c.getUTCHours())}:${pad(c.getUTCMinutes())}:${pad(c.getUTCSeconds())}`;
}

/** 相对时间:刚刚 / N 分钟前 / N 小时前 / N 天前 / 超过 30 天显示日期 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`;
  return formatDateTime(iso).slice(0, 10);
}

/** 数量展示:1 万以内原样,以上折算「x.x万」 */
export function formatCount(n: number | null | undefined): string {
  if (!n || n <= 0) return '0';
  if (n < 10_000) return String(n);
  return `${(n / 10_000).toFixed(1).replace(/\.0$/, '')}万`;
}
