/**
 * EPUB 3 生成器（见方案 §8、§9）。
 *
 * 生成结构：
 *   mimetype                 （首个、不压缩）
 *   META-INF/container.xml
 *   OEBPS/content.opf        （EPUB 3 package document）
 *   OEBPS/nav.xhtml          （EPUB 3 导航文档）
 *   OEBPS/toc.ncx            （向后兼容的 NCX）
 *   OEBPS/styles/style.css
 *   OEBPS/images/cover.*     （封面资源）
 *   OEBPS/text/cover.xhtml   （封面页）
 *   OEBPS/text/chapter-NNN.xhtml
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import archiver from 'archiver';
import type { BookMeta, Chapter } from '../types.js';
import { escapeXml, nowIso, uuidV5 } from '../util.js';
import { DEFAULT_CSS } from './styles.js';

export interface EpubInput {
  meta: BookMeta;
  chapters: Chapter[];
  coverPath?: string;
  outPath: string;
  identifier?: string;
  modified?: string;
}

interface CoverAsset {
  href: string; // 相对 OEBPS 根
  mediaType: string;
  data: string | Buffer;
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

function chapterFileName(order: number): string {
  return `text/chapter-${pad(order)}.xhtml`;
}

function coverMediaType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

/** 无封面时自动生成的 SVG 封面。 */
function fallbackCoverSvg(meta: BookMeta): string {
  const title = escapeXml(meta.title ?? 'Untitled');
  const author = escapeXml(meta.author ?? '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#24324d" />
      <stop offset="1" stop-color="#0c1220" />
    </linearGradient>
  </defs>
  <rect width="1200" height="1600" fill="url(#bg)" />
  <rect x="60" y="60" width="1080" height="1480" fill="none" stroke="#5a6b8c" stroke-width="3" />
  <text x="600" y="720" text-anchor="middle" font-family="'Noto Serif CJK SC','SimSun',serif" font-size="110" font-weight="bold" fill="#f2f0e9">${title}</text>
  <text x="600" y="860" text-anchor="middle" font-family="'Noto Serif CJK SC','SimSun',serif" font-size="52" fill="#9aa5bd">${author}</text>
  <line x1="400" y1="920" x2="800" y2="920" stroke="#5a6b8c" stroke-width="2" />
</svg>
`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`;
}

function chapterXhtml(chapter: Chapter, lang: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/style.css" />
</head>
<body>
  <article class="chapter">
    <h1 class="chapter-title">${escapeXml(chapter.title)}</h1>
    <div class="chapter-content">
${chapter.content}
    </div>
  </article>
</body>
</html>
`;
}

function coverXhtml(lang: string, coverHref: string, title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8" />
  <title>封面</title>
  <link rel="stylesheet" type="text/css" href="../styles/style.css" />
</head>
<body>
  <div class="cover"><img src="../${coverHref}" alt="${escapeXml(title)}" /></div>
</body>
</html>
`;
}

function navXhtml(chapters: Chapter[], lang: string): string {
  const items = chapters
    .map((c) => {
      const href = chapterFileName(c.order);
      return `      <li><a href="${href}">${escapeXml(c.title)}</a></li>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8" />
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="styles/style.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="">
    <ol>
      <li><a epub:type="bodymatter" href="text/chapter-001.xhtml">开始阅读</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function tocNcx(chapters: Chapter[], uid: string, title: string): string {
  const navPoints = chapters
    .map((c, i) => {
      const id = `chap-${c.order}`;
      const href = chapterFileName(c.order);
      return `    <navPoint id="${id}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${href}" />
    </navPoint>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">
  <head>
    <meta name="dtb:uid" content="${escapeXml(uid)}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

function contentOpf(
  meta: BookMeta,
  chapters: Chapter[],
  cover: CoverAsset | null,
  uid: string,
  modified: string,
): string {
  const lang = meta.language || 'zh-CN';

  const metaItems: string[] = [];
  metaItems.push(`    <dc:identifier id="pub-id">${escapeXml(uid)}</dc:identifier>`);
  metaItems.push(`    <dc:title>${escapeXml(meta.title)}</dc:title>`);
  metaItems.push(`    <dc:language>${escapeXml(lang)}</dc:language>`);
  if (meta.author) {
    metaItems.push(`    <dc:creator id="creator">${escapeXml(meta.author)}</dc:creator>`);
    metaItems.push(`    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>`);
  }
  if (meta.description) metaItems.push(`    <dc:description>${escapeXml(meta.description)}</dc:description>`);
  if (meta.publisher) metaItems.push(`    <dc:publisher>${escapeXml(meta.publisher)}</dc:publisher>`);
  if (meta.year != null) metaItems.push(`    <dc:date>${escapeXml(String(meta.year))}</dc:date>`);
  if (meta.rights) metaItems.push(`    <dc:rights>${escapeXml(meta.rights)}</dc:rights>`);
  for (const tag of meta.tags ?? []) {
    metaItems.push(`    <dc:subject>${escapeXml(tag)}</dc:subject>`);
  }
  if (meta.series) {
    metaItems.push(`    <meta property="belongs-to-collection" id="series">${escapeXml(meta.series.name)}</meta>`);
    if (meta.series.index != null) {
      metaItems.push(`    <meta refines="#series" property="group-position">${meta.series.index}</meta>`);
    }
  }
  metaItems.push(`    <meta property="dcterms:modified">${escapeXml(modified)}</meta>`);
  if (cover) metaItems.push(`    <meta name="cover" content="cover-image" />`);

  const manifestItems: string[] = [];
  manifestItems.push(`    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />`);
  manifestItems.push(`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />`);
  manifestItems.push(`    <item id="css" href="styles/style.css" media-type="text/css" />`);
  if (cover) {
    manifestItems.push(
      `    <item id="cover-image" href="${cover.href}" media-type="${cover.mediaType}" properties="cover-image" />`,
    );
    manifestItems.push(`    <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml" />`);
  }
  for (const c of chapters) {
    manifestItems.push(
      `    <item id="chap-${c.order}" href="${chapterFileName(c.order)}" media-type="application/xhtml+xml" />`,
    );
  }

  const spineItems: string[] = [];
  if (cover) spineItems.push(`    <itemref idref="cover" />`);
  for (const c of chapters) spineItems.push(`    <itemref idref="chap-${c.order}" />`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${metaItems.join('\n')}
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>
</package>
`;
}

interface ZipEntry {
  name: string;
  data: string | Buffer;
  store?: boolean;
}

/** 固定 ZIP 条目时间戳，保证相同输入产生字节一致的 EPUB（幂等）。 */
const FIXED_ENTRY_DATE = new Date('1980-01-01T00:00:00Z');

async function zipEpub(outPath: string, entries: ZipEntry[]): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const output = createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const closed = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') {
        // 警告不致命，忽略记录。
      }
    });
  });

  archive.pipe(output);

  for (const e of entries) {
    archive.append(e.data, { name: e.name, store: e.store === true, date: FIXED_ENTRY_DATE });
  }

  await archive.finalize();
  await closed;
}

/** 生成 EPUB 3 文件。 */
export async function generateEpub(input: EpubInput): Promise<void> {
  const { meta, chapters, coverPath, outPath } = input;
  const lang = meta.language || 'zh-CN';
  const identifier = input.identifier || uuidV5(meta.title ?? 'novel');
  const uid = `urn:uuid:${identifier}`;
  const modified = input.modified || nowIso();

  let cover: CoverAsset | null = null;
  if (coverPath) {
    const ext = extname(coverPath);
    const data = await readFile(coverPath);
    cover = { href: `images/cover${ext}`, mediaType: coverMediaType(ext), data };
  } else {
    cover = { href: 'images/cover.svg', mediaType: 'image/svg+xml', data: fallbackCoverSvg(meta) };
  }

  const entries: ZipEntry[] = [];
  entries.push({ name: 'mimetype', data: 'application/epub+zip', store: true });
  entries.push({ name: 'META-INF/container.xml', data: containerXml() });
  entries.push({
    name: 'OEBPS/content.opf',
    data: contentOpf(meta, chapters, cover, uid, modified),
  });
  entries.push({ name: 'OEBPS/nav.xhtml', data: navXhtml(chapters, lang) });
  entries.push({ name: 'OEBPS/toc.ncx', data: tocNcx(chapters, uid, meta.title) });
  entries.push({ name: 'OEBPS/styles/style.css', data: DEFAULT_CSS });
  entries.push({ name: join('OEBPS', cover.href), data: cover.data });
  entries.push({ name: 'OEBPS/text/cover.xhtml', data: coverXhtml(lang, cover.href, meta.title) });
  for (const c of chapters) {
    entries.push({ name: join('OEBPS', chapterFileName(c.order)), data: chapterXhtml(c, lang) });
  }

  await zipEpub(outPath, entries);
}
