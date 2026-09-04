/**
 * 动态封面生成器(读者站兜底封面)。
 *
 * 当书籍没有上传封面(coverPath 为空)时,读者站按 分类/题材 渲染一张
 * 书本形 SVG 封面(300×400,与卡片 aspect-[3/4] 一致),替代原来的首字占位。
 *
 * 设计取向:
 * - 统一的"书"骨架(书脊 / 封面 / 页边 / 书签绳 / 阴影),与设计稿一致;
 * - 按题材关键词选择主题(治愈 / 科幻 / 古风 / 悬疑 / 言情 / 都市 / 校园 /
 *   历史 / 冒险 / 默认),主题决定配色、装饰母题、字体与标题排布;
 * - 纯字符串生成、无外部依赖,便于 verify 脚本与路由复用。
 */

export interface CoverInput {
  title: string;
  author: string;
  category: string;
  /** 'serializing' | 'completed' | ... 仅影响状态徽标文案 */
  status: string;
  kind: 'short' | 'long';
  chapterCount: number;
}

interface Theme {
  id: string;
  keywords: string[];
  label: string;
  serif?: boolean;
  bg: [string, string];
  ink: string;
  accent: string;
  soft: string[];
  page: string;
  spine: [string, string];
  motif: (t: Theme) => string;
}

const SANS = "'PingFang SC','Microsoft YaHei',sans-serif";
const SERIF = "'Noto Serif CJK SC','SimSun',serif";

/** 主题母题:全部绘制在封面区域内(x 47..270, y 25..375),wc/wcSoft 为水彩模糊滤镜 */
const THEMES: Theme[] = [
  {
    id: 'heal',
    keywords: ['治愈', '暖心', '温情', '亲情', '友情', '家庭', '励志', '温柔'],
    label: '治愈',
    bg: ['#f5f8fa', '#dce6ec'],
    ink: '#2a4a55',
    accent: '#2a4a55',
    soft: ['#a8c4d0', '#c0d8d0', '#b0c8c0', '#e0eef0', '#d0e0e0'],
    page: '#e0d8cc',
    spine: ['#8a9ca8', '#b0c4d0'],
    motif: (t) => `
      <circle cx="120" cy="140" r="50" fill="${t.soft[0]}" opacity="0.2" filter="url(#wc)"/>
      <circle cx="200" cy="120" r="40" fill="${t.soft[1]}" opacity="0.25" filter="url(#wc)"/>
      <circle cx="150" cy="260" r="60" fill="${t.soft[2]}" opacity="0.15" filter="url(#wc)"/>
      <circle cx="130" cy="190" r="25" fill="${t.soft[3]}" opacity="0.4" filter="url(#wcSoft)"/>
      <circle cx="190" cy="220" r="20" fill="${t.soft[4]}" opacity="0.3" filter="url(#wcSoft)"/>`,
  },
  {
    id: 'scifi',
    keywords: ['科幻', '星际', '赛博朋克', '末世', '末日', '未来', '机甲'],
    label: '科幻',
    bg: ['#0b1026', '#1b2440'],
    ink: '#e8f1ff',
    accent: '#7dd3fc',
    soft: ['#38bdf8', '#a78bfa', '#f472b6', '#94a3b8', '#e2e8f0'],
    page: '#1c2740',
    spine: ['#1e3a8a', '#3b82f6'],
    motif: (t) => `
      <g stroke="${t.accent}" stroke-width="0.4" opacity="0.12">
        <line x1="70" y1="40" x2="70" y2="360"/><line x1="100" y1="40" x2="100" y2="360"/>
        <line x1="130" y1="40" x2="130" y2="360"/><line x1="160" y1="40" x2="160" y2="360"/>
        <line x1="190" y1="40" x2="190" y2="360"/><line x1="220" y1="40" x2="220" y2="360"/>
        <line x1="250" y1="40" x2="250" y2="360"/>
        <line x1="50" y1="90" x2="265" y2="90"/><line x1="50" y1="180" x2="265" y2="180"/>
        <line x1="50" y1="270" x2="265" y2="270"/><line x1="50" y1="350" x2="265" y2="350"/>
      </g>
      <circle cx="215" cy="120" r="30" fill="${t.soft[0]}" opacity="0.45"/>
      <ellipse cx="215" cy="120" rx="46" ry="12" fill="none" stroke="${t.soft[1]}" stroke-width="1.5" opacity="0.7" transform="rotate(-18 215 120)"/>
      <circle cx="80" cy="70" r="1.4" fill="#ffffff" opacity="0.9"/><circle cx="110" cy="52" r="1" fill="#ffffff" opacity="0.7"/>
      <circle cx="150" cy="66" r="1.6" fill="#ffffff" opacity="0.85"/><circle cx="230" cy="60" r="1.1" fill="#ffffff" opacity="0.75"/>
      <circle cx="90" cy="120" r="1" fill="#ffffff" opacity="0.6"/><circle cx="70" cy="200" r="1.4" fill="#ffffff" opacity="0.8"/>
      <circle cx="130" cy="300" r="1.2" fill="#ffffff" opacity="0.7"/><circle cx="200" cy="330" r="1.5" fill="#ffffff" opacity="0.85"/>
      <circle cx="250" cy="300" r="1" fill="#ffffff" opacity="0.65"/><circle cx="60" cy="320" r="1.1" fill="#ffffff" opacity="0.6"/>`,
  },
  {
    id: 'xianxia',
    keywords: ['玄幻', '仙侠', '武侠', '古风', '洪荒', '修真', '神话', '国术'],
    label: '仙侠',
    serif: true,
    bg: ['#f5efe2', '#e4d9c0'],
    ink: '#43341f',
    accent: '#8a5a2b',
    soft: ['#d9c8a0', '#8a6f4d', '#5b4632', '#b8a27e', '#efe6d0'],
    page: '#e8dcc4',
    spine: ['#7c5f3d', '#a98b5f'],
    motif: (t) => `
      <circle cx="150" cy="120" r="40" fill="${t.soft[0]}" opacity="0.5" filter="url(#wcSoft)"/>
      <polygon points="60,300 110,190 160,300" fill="${t.soft[1]}" opacity="0.55"/>
      <polygon points="120,300 190,150 260,300" fill="${t.soft[2]}" opacity="0.5"/>
      <polygon points="70,300 140,215 215,300" fill="${t.soft[3]}" opacity="0.45"/>
      <ellipse cx="120" cy="245" rx="62" ry="12" fill="${t.soft[4]}" opacity="0.3" filter="url(#wcSoft)"/>
      <ellipse cx="205" cy="275" rx="52" ry="10" fill="${t.soft[4]}" opacity="0.25" filter="url(#wcSoft)"/>`,
  },
  {
    id: 'mystery',
    keywords: ['悬疑', '推理', '惊悚', '灵异', '恐怖', '克苏鲁', '轻悬疑', '反转', '脑洞'],
    label: '悬疑',
    bg: ['#101418', '#1f2730'],
    ink: '#e8e6e1',
    accent: '#c93a3a',
    soft: ['#37414d', '#4b5a6b', '#22303c', '#5f6b76', '#0d1116'],
    page: '#1a212b',
    spine: ['#232b36', '#3a4654'],
    motif: (t) => `
      <circle cx="205" cy="95" r="26" fill="#f4f1ea" opacity="0.9"/>
      <circle cx="214" cy="88" r="24" fill="${t.bg[1]}" opacity="0.95"/>
      <ellipse cx="120" cy="185" rx="82" ry="18" fill="${t.soft[0]}" opacity="0.4" filter="url(#wc)"/>
      <ellipse cx="215" cy="225" rx="72" ry="16" fill="${t.soft[1]}" opacity="0.3" filter="url(#wc)"/>
      <rect x="80" y="262" width="18" height="78" fill="${t.soft[2]}" opacity="0.55"/>
      <rect x="120" y="232" width="24" height="108" fill="${t.soft[3]}" opacity="0.5"/>
      <rect x="170" y="272" width="16" height="68" fill="${t.soft[2]}" opacity="0.45"/>
      <rect x="212" y="248" width="22" height="92" fill="${t.soft[3]}" opacity="0.5"/>`,
  },
  {
    id: 'romance',
    keywords: ['言情', '甜宠', '爱情', '宫斗', '虐心', '恋'],
    label: '言情',
    bg: ['#fdf0f4', '#f6d7e3'],
    ink: '#7d2c4e',
    accent: '#d4578a',
    soft: ['#f2b3c8', '#f6c9d9', '#e89ab6', '#fbe3ec', '#f0a5c2'],
    page: '#f8e2ec',
    spine: ['#c26a93', '#e59fc0'],
    motif: (t) => `
      <ellipse cx="120" cy="120" rx="16" ry="7" fill="${t.soft[0]}" opacity="0.65" transform="rotate(-30 120 120)"/>
      <ellipse cx="200" cy="150" rx="14" ry="6" fill="${t.soft[1]}" opacity="0.65" transform="rotate(22 200 150)"/>
      <ellipse cx="90" cy="220" rx="15" ry="6" fill="${t.soft[2]}" opacity="0.55" transform="rotate(-15 90 220)"/>
      <ellipse cx="222" cy="248" rx="13" ry="6" fill="${t.soft[3]}" opacity="0.6" transform="rotate(34 222 248)"/>
      <ellipse cx="150" cy="300" rx="14" ry="6" fill="${t.soft[4]}" opacity="0.55" transform="rotate(-26 150 300)"/>
      <path d="M160 182 q10 -15 20 0 q10 15 20 0 q-4 -19 -20 -15 q-16 -4 -20 15 z" fill="${t.accent}" opacity="0.5"/>`,
  },
  {
    id: 'urban',
    keywords: ['都市', '职场', '现实', '商战', '娱乐', '明星', '直播', '神医', '学霸'],
    label: '都市',
    bg: ['#eef1f6', '#dbe2ec'],
    ink: '#22303f',
    accent: '#3f6ea8',
    soft: ['#f2b84b', '#6f8db2', '#93a9c4', '#b9c7d9', '#cfd9e6'],
    page: '#e3e8f0',
    spine: ['#4a6b96', '#7795bc'],
    motif: (t) => `
      <circle cx="212" cy="92" r="22" fill="${t.soft[0]}" opacity="0.75"/>
      <rect x="70" y="242" width="22" height="98" fill="${t.soft[1]}" opacity="0.6"/>
      <rect x="105" y="202" width="26" height="138" fill="${t.soft[2]}" opacity="0.65"/>
      <rect x="145" y="262" width="20" height="78" fill="${t.soft[1]}" opacity="0.55"/>
      <rect x="180" y="216" width="24" height="124" fill="${t.soft[3]}" opacity="0.65"/>
      <rect x="220" y="252" width="18" height="88" fill="${t.soft[2]}" opacity="0.55"/>
      <g fill="${t.ink}" opacity="0.35">
        <rect x="110" y="212" width="4" height="4"/><rect x="118" y="222" width="4" height="4"/>
        <rect x="110" y="240" width="4" height="4"/><rect x="118" y="250" width="4" height="4"/>
        <rect x="186" y="228" width="4" height="4"/><rect x="194" y="238" width="4" height="4"/>
        <rect x="186" y="256" width="4" height="4"/><rect x="194" y="266" width="4" height="4"/>
      </g>`,
  },
  {
    id: 'campus',
    keywords: ['校园', '青春', '二次元', '轻小说', '萌宝', '宠物'],
    label: '青春',
    bg: ['#eef9ff', '#d9f2ff'],
    ink: '#175a7d',
    accent: '#2f9ed8',
    soft: ['#63c7f2', '#f4c95d', '#f290b0', '#9ed39b', '#c4b0f0'],
    page: '#e4f5fd',
    spine: ['#3ba7dd', '#7ed0f2'],
    motif: (t) => `
      <rect x="88" y="88" width="15" height="15" rx="2" fill="${t.soft[0]}" opacity="0.7" transform="rotate(15 95 95)"/>
      <circle cx="210" cy="122" r="9" fill="${t.soft[1]}" opacity="0.75"/>
      <polygon points="118,182 132,204 104,204" fill="${t.soft[2]}" opacity="0.6"/>
      <rect x="180" y="200" width="13" height="13" rx="2" fill="${t.soft[3]}" opacity="0.65" transform="rotate(-20 186 206)"/>
      <circle cx="100" cy="262" r="7" fill="${t.soft[4]}" opacity="0.6"/>
      <polygon points="210,262 222,284 198,284" fill="${t.soft[0]}" opacity="0.55"/>
      <circle cx="150" cy="330" r="5" fill="${t.soft[1]}" opacity="0.5"/>`,
  },
  {
    id: 'history',
    keywords: ['历史', '军事', '谍战', '抗战', '权谋', '穿越'],
    label: '历史',
    serif: true,
    bg: ['#efe7d2', '#dccdb0'],
    ink: '#443621',
    accent: '#8a6b33',
    soft: ['#c9b489', '#a58a55', '#7d6a41', '#e2d5b6', '#b39a68'],
    page: '#e6d9bb',
    spine: ['#8a6b33', '#b39a68'],
    motif: (t) => `
      <rect x="90" y="196" width="18" height="92" fill="${t.soft[1]}" opacity="0.5"/>
      <rect x="204" y="196" width="18" height="92" fill="${t.soft[1]}" opacity="0.5"/>
      <rect x="85" y="186" width="28" height="12" fill="${t.soft[2]}" opacity="0.6"/>
      <rect x="199" y="186" width="28" height="12" fill="${t.soft[2]}" opacity="0.6"/>
      <path d="M99 200 Q158 122 217 200" fill="none" stroke="${t.accent}" stroke-width="1.4" opacity="0.55"/>
      <circle cx="158" cy="130" r="20" fill="${t.soft[3]}" opacity="0.5" filter="url(#wcSoft)"/>
      <ellipse cx="158" cy="310" rx="80" ry="14" fill="${t.soft[4]}" opacity="0.3" filter="url(#wcSoft)"/>`,
  },
  {
    id: 'adventure',
    keywords: ['冒险', '游戏', '网游', '竞技', '体育', '无限流', '快穿', '系统', '基建', '种田', '美食', '召唤流', '无敌流'],
    label: '冒险',
    bg: ['#0f3d3e', '#16504c'],
    ink: '#eafff2',
    accent: '#f2b84b',
    soft: ['#f2b84b', '#5fd0a8', '#8fd8c0', '#2e8b7c', '#b7e8d5'],
    page: '#134542',
    spine: ['#177a6f', '#2ea08f'],
    motif: (t) => `
      <circle cx="158" cy="140" r="34" fill="none" stroke="${t.accent}" stroke-width="1.2" opacity="0.65"/>
      <line x1="158" y1="106" x2="158" y2="174" stroke="${t.accent}" stroke-width="0.8" opacity="0.55"/>
      <line x1="124" y1="140" x2="192" y2="140" stroke="${t.accent}" stroke-width="0.8" opacity="0.55"/>
      <polygon points="158,106 151,140 165,140" fill="${t.accent}" opacity="0.8"/>
      <polygon points="158,174 151,140 165,140" fill="${t.soft[1]}" opacity="0.8"/>
      <path d="M80 300 q40 -52 92 -30 t92 -22" fill="none" stroke="${t.soft[2]}" stroke-width="2" stroke-dasharray="5 5" opacity="0.6"/>
      <polygon points="70,340 110,292 150,340" fill="${t.soft[3]}" opacity="0.5"/>
      <polygon points="130,340 178,280 226,340" fill="${t.soft[4]}" opacity="0.45"/>`,
  },
  {
    id: 'default',
    keywords: [],
    label: '文学',
    bg: ['#f4f5f7', '#e2e5ea'],
    ink: '#333a45',
    accent: '#5b6b80',
    soft: ['#c3ccd8', '#d5dbe4', '#9aa7b8', '#eef0f4', '#7f8fa3'],
    page: '#e6e9ee',
    spine: ['#5b6b80', '#8b9bb0'],
    motif: (t) => `
      <circle cx="158" cy="150" r="46" fill="none" stroke="${t.soft[0]}" stroke-width="1.2" opacity="0.5"/>
      <circle cx="158" cy="150" r="72" fill="none" stroke="${t.soft[1]}" stroke-width="0.8" opacity="0.35"/>
      <line x1="92" y1="118" x2="116" y2="118" stroke="${t.soft[2]}" stroke-width="1.4" opacity="0.5"/>
      <line x1="92" y1="150" x2="122" y2="150" stroke="${t.soft[2]}" stroke-width="1.4" opacity="0.45"/>
      <line x1="92" y1="182" x2="112" y2="182" stroke="${t.soft[2]}" stroke-width="1.4" opacity="0.4"/>
      <circle cx="204" cy="128" r="4" fill="${t.soft[4]}" opacity="0.55"/>
      <circle cx="216" cy="168" r="3" fill="${t.soft[2]}" opacity="0.5"/>
      <circle cx="198" cy="206" r="5" fill="${t.soft[4]}" opacity="0.45"/>`,
  },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\r\n\t]/g, '');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** 按分类/题材关键词选主题;未命中回退 default */
export function pickTheme(category: string): Theme {
  const hit = THEMES.find((t) => t.keywords.some((k) => category.includes(k)));
  return hit ?? THEMES[THEMES.length - 1]!;
}

/** 纯 CJK 标题 → 竖排;含拉丁/数字或过长 → 横排 */
function useVerticalTitle(title: string): boolean {
  return /^[\u4e00-\u9fff·—…、。，！？""''（）]+$/.test(title) && title.length <= 10;
}

function verticalTitle(title: string, ink: string, font: string): string {
  const chars = [...title];
  const n = chars.length;
  const fs = n <= 4 ? 26 : n <= 6 ? 22 : n <= 8 ? 18 : 15;
  const dy = fs + 8;
  // 以封面中部(y≈200)为轴心排布,保证最长 10 字也落在状态徽标(320)之上
  const startY = 200 - ((n - 1) * dy) / 2;
  const tspans = chars
    .map((c, i) => `<tspan x="100" y="${(startY + i * dy).toFixed(1)}">${escapeXml(c)}</tspan>`)
    .join('');
  return `<text font-family="${font}" font-size="${fs}" font-weight="300" fill="${ink}" text-anchor="middle" letter-spacing="4">${tspans}</text>`;
}

/** 非纯中文标题按词分拆(拉丁/数字/空格),纯中文按字符宽度分列 */
function splitTitleLines(chars: string[], perLine: number): string[] {
  const joined = chars.join('');
  if (!/^[\u4e00-\u9fff·—…、。，！？""''（）]+$/.test(joined)) {
    // 含拉丁/数字:按空格分词的词序列排布,避免单词被腰斩
    const words = joined.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if ([...next].length <= perLine) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length > 0 ? lines : [joined];
  }
  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += perLine) lines.push(chars.slice(i, i + perLine).join(''));
  return lines;
}

function horizontalTitle(title: string, ink: string, font: string): string {
  const chars = [...title];
  const n = chars.length;
  const fs = n <= 4 ? 28 : n <= 8 ? 24 : n <= 12 ? 20 : 16;
  const perLine = Math.max(6, Math.ceil(n / Math.ceil(n / 8)));
  const lines = splitTitleLines(chars, perLine);
  const lh = fs * 1.5;
  const startY = 210 - ((lines.length - 1) * lh) / 2;
  const tspans = lines
    .map((ln, i) => `<tspan x="158" y="${(startY + i * lh).toFixed(1)}">${escapeXml(ln)}</tspan>`)
    .join('');
  return `<text font-family="${font}" font-size="${fs}" font-weight="300" fill="${ink}" text-anchor="middle" letter-spacing="2">${tspans}</text>`;
}

/** 作者:短 CJK 竖排在右侧(如设计稿),其余横排在左下 */
function authorText(author: string, ink: string, font: string): string {
  if (/^[\u4e00-\u9fff·]{1,4}$/.test(author)) {
    const chars = [...author];
    const startY = 200 - (chars.length * 20) / 2;
    const tspans = chars
      .map((c, i) => `<tspan x="212" y="${(startY + i * 20).toFixed(1)}">${escapeXml(c)}</tspan>`)
      .join('');
    return `<text font-family="${font}" font-size="12" fill="${ink}" text-anchor="middle" letter-spacing="2">${tspans}<tspan x="212" dy="20">著</tspan></text>`;
  }
  const s = truncate(author.replace(/[\r\n\t]/g, ''), 12);
  return `<text x="70" y="345" font-family="${font}" font-size="10" fill="${ink}" opacity="0.6" text-anchor="start">${escapeXml(s)}</text>`;
}

/**
 * 渲染书籍动态封面 SVG(300×400)。
 * 骨架(书脊/封面/页边/书签绳/阴影)与设计稿一致,配色与母题随题材主题变化。
 */
export function renderCoverSvg(input: CoverInput): string {
  const t = pickTheme(input.category ?? '');
  const font = t.serif ? SERIF : SANS;
  const statusText = input.kind === 'short' ? '短篇' : input.status === 'serializing' ? '连载中' : '完结';
  const footer = `${truncate(input.category || '未分类', 8)}${input.kind === 'short' ? '短篇' : ''} · 共${input.chapterCount}章`;
  const spineChars = [...(input.category || t.label)].slice(0, 2);

  const titleMarkup = useVerticalTitle(input.title)
    ? verticalTitle(input.title, t.ink, font)
    : horizontalTitle(input.title, t.ink, font);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
  <defs>
    <filter id="shadow" x="-5%" y="-5%" width="120%" height="120%">
      <feDropShadow dx="5" dy="8" stdDeviation="6" flood-color="#000" flood-opacity="0.7"/>
    </filter>
    <filter id="wc" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
    <filter id="wcSoft" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <pattern id="pages" width="10" height="4" patternUnits="userSpaceOnUse">
      <line x1="0" y1="2" x2="10" y2="2" stroke="#b8ada0" stroke-width="0.4"/>
    </pattern>
    <linearGradient id="coverBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.bg[0]}"/><stop offset="100%" stop-color="${t.bg[1]}"/>
    </linearGradient>
    <linearGradient id="spineBg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${t.spine[0]}"/><stop offset="100%" stop-color="${t.spine[1]}"/>
    </linearGradient>
  </defs>

  <g filter="url(#shadow)">
    <!-- 书脊 -->
    <rect x="15" y="25" width="32" height="350" rx="3" fill="url(#spineBg)"/>
    <line x1="15" y1="40" x2="47" y2="40" stroke="#ffffff" stroke-width="0.5" opacity="0.35"/>
    <text x="31" y="80" font-family="'Arial',sans-serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle" opacity="0.85">AI</text>
    ${spineChars
      .map((c, i) => `<text x="31" y="${104 + i * 14}" font-family="${font}" font-size="10" fill="#ffffff" text-anchor="middle" opacity="0.7">${escapeXml(c)}</text>`)
      .join('')}

    <!-- 封面 -->
    <rect x="47" y="25" width="223" height="350" rx="2" fill="url(#coverBg)"/>
    <rect x="55" y="33" width="207" height="334" fill="none" stroke="${t.accent}" stroke-width="0.8" opacity="0.18"/>

    <!-- 题材母题 -->
    ${t.motif(t)}

    <!-- 书名 -->
    ${titleMarkup}

    <!-- 作者 -->
    ${authorText(input.author, t.ink, font)}

    <!-- 状态徽标(右下) -->
    <rect x="180" y="320" width="76" height="18" rx="9" fill="${t.accent}" opacity="0.12"/>
    <text x="218" y="333" font-family="${font}" font-size="10" fill="${t.accent}" text-anchor="middle">${statusText}</text>

    <text x="158" y="360" font-family="${font}" font-size="9" fill="${t.ink}" opacity="0.35" text-anchor="middle">${escapeXml(footer)}</text>

    <!-- 页边 -->
    <rect x="270" y="25" width="15" height="350" fill="${t.page}"/>
    <rect x="270" y="25" width="15" height="350" fill="url(#pages)"/>
    <line x1="272" y1="25" x2="272" y2="375" stroke="#ffffff" stroke-width="1" opacity="0.7"/>

    <!-- 书签绳 -->
    <path d="M 170 375 L 170 395 L 180 392 L 190 395 L 190 375 Z" fill="${t.spine[1]}" opacity="0.9"/>
  </g>
</svg>`;
}

/** 读者站封面 URL:有上传封面用原图,否则走动态封面接口 */
export function coverSrc(m: { coverPath?: string | null; slug: string }): string {
  if (m.coverPath) return m.coverPath.startsWith('/') ? m.coverPath : `/${m.coverPath}`;
  return `/api/covers/${m.slug}`;
}

/** 小图标(列表行缩略图)URL:有上传封面用原图,否则走 ?s=icon 小图标变体 */
export function coverIconSrc(m: { coverPath?: string | null; slug: string }): string {
  if (m.coverPath) return m.coverPath.startsWith('/') ? m.coverPath : `/${m.coverPath}`;
  return `/api/covers/${m.slug}?s=icon`;
}

/** 48×48 小图标母题:绘制在封面区域(x 8..46, y 4..44),上方留白给水彩色块 */
const ICON_MOTIFS: Record<string, (t: Theme) => string> = {
  heal: (t) => `
    <path d="M 24 12 Q 28 20 24 26 Q 20 20 24 12 Z" fill="${t.ink}" opacity="0.8"/>
    <path d="M 18 28 Q 20 32 18 35 Q 16 32 18 28 Z" fill="${t.ink}" opacity="0.5"/>`,
  scifi: (t) => `
    <circle cx="24" cy="18" r="5" fill="${t.soft[0]}" opacity="0.85"/>
    <ellipse cx="24" cy="18" rx="8.5" ry="2.6" fill="none" stroke="${t.accent}" stroke-width="1" opacity="0.85" transform="rotate(-18 24 18)"/>
    <circle cx="31" cy="13" r="1.1" fill="#ffffff" opacity="0.9"/>
    <circle cx="20" cy="12" r="0.8" fill="#ffffff" opacity="0.7"/>`,
  xianxia: (t) => `
    <polygon points="18,30 24,15 30,30" fill="${t.soft[1]}" opacity="0.75"/>
    <polygon points="26,30 32,19 38,30" fill="${t.soft[2]}" opacity="0.6"/>
    <circle cx="27" cy="23" r="3" fill="${t.accent}" opacity="0.55"/>`,
  mystery: (t) => `
    <circle cx="26" cy="17" r="6" fill="#e8e6e1" opacity="0.92"/>
    <circle cx="29" cy="15" r="5.4" fill="${t.bg[0]}" opacity="0.95"/>`,
  romance: (t) => `
    <path d="M 24 28 C 21.5 25 17.5 26.2 17.5 29.6 C 17.5 33 24 36.2 24 36.2 C 24 36.2 30.5 33 30.5 29.6 C 30.5 26.2 26.5 25 24 28 Z" fill="${t.accent}" opacity="0.8"/>`,
  urban: (t) => `
    <rect x="17" y="22" width="4" height="10" fill="${t.soft[1]}" opacity="0.7"/>
    <rect x="22" y="17" width="5" height="15" fill="${t.soft[2]}" opacity="0.85"/>
    <rect x="28" y="24" width="4" height="8" fill="${t.soft[1]}" opacity="0.6"/>
    <circle cx="31" cy="14" r="2.6" fill="${t.soft[0]}" opacity="0.9"/>`,
  campus: (t) => `
    <polygon points="19,27 25,16 31,27" fill="${t.soft[0]}" opacity="0.75"/>
    <circle cx="26" cy="21" r="1.4" fill="${t.accent}"/>
    <circle cx="29" cy="28" r="1.8" fill="${t.soft[1]}" opacity="0.9"/>`,
  history: (t) => `
    <path d="M 21 29 v -9 h 4 v 9" stroke="${t.accent}" stroke-width="1.6" fill="none" opacity="0.85"/>
    <path d="M 18 20 q 5 -5 10 0" stroke="${t.accent}" stroke-width="1.2" fill="none" opacity="0.7"/>`,
  adventure: (t) => `
    <circle cx="24" cy="20" r="6" fill="none" stroke="${t.accent}" stroke-width="1.3" opacity="0.85"/>
    <path d="M 24 15 L 27.2 23.5 L 24 21.6 L 20.8 23.5 Z" fill="${t.accent}" opacity="0.85"/>`,
  default: (t) => `
    <circle cx="24" cy="20" r="6" fill="${t.soft[0]}" opacity="0.55"/>
    <circle cx="24" cy="20" r="2.6" fill="${t.accent}" opacity="0.75"/>`,
};

/**
 * 渲染书籍小图标 SVG(默认 48×48,列表行缩略图用)。
 * 与参考稿一致:圆角底板 + 书脊 + 封面 + 水彩色块 + 题材母题 + 左下分类字。
 * 有上传封面的书籍不走此变体(coverIconSrc 直接回原图)。
 */
export function renderCoverIconSvg(input: CoverInput, size = 48): string {
  const t = pickTheme(input.category ?? '');
  const font = t.serif ? SERIF : SANS;
  const label = truncate(input.category || t.label, 4);
  const motif = (ICON_MOTIFS[t.id] ?? ICON_MOTIFS.default)(t);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
  <!-- 底板 -->
  <rect width="48" height="48" rx="8" fill="${t.bg[1]}"/>
  <!-- 书脊 -->
  <rect x="2" y="4" width="6" height="40" rx="1" fill="${t.spine[1]}"/>
  <!-- 封面 -->
  <rect x="8" y="4" width="38" height="40" rx="2" fill="${t.bg[0]}"/>
  <!-- 水彩色块 -->
  <circle cx="24" cy="18" r="6" fill="${t.soft[0]}" opacity="0.3"/>
  <circle cx="30" cy="28" r="8" fill="${t.soft[1]}" opacity="0.25"/>
  <!-- 题材母题 -->
  ${motif}
  <!-- 分类字(左下) -->
  <text x="11" y="38" font-family="${font}" font-size="8" fill="${t.ink}" opacity="0.6">${escapeXml(label)}</text>
</svg>`;
}
