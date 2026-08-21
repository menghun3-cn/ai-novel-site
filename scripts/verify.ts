/**
 * 端到端验证脚本：构建全部小说，并校验 EPUB 结构。
 *
 * 运行：npm test  （或 pnpm tsx scripts/verify.ts）
 */
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { NovelBuilder } from '../src/builder.js';
import { createAdapter } from '../src/sync/adapter.js';

/** 校验 EPUB 的 mimetype 是否为第一个、且未压缩（EPUB 规范要求）。 */
function checkEpubMimetype(buf: Buffer): string | null {
  if (buf.length < 58) return 'file too small';
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return 'not a zip (missing PK magic)';
  const name = buf.subarray(30, 38).toString('utf8');
  const data = buf.subarray(38, 58).toString('utf8');
  if (name !== 'mimetype') return `first entry is "${name}", expected "mimetype"`;
  if (data !== 'application/epub+zip') return `mimetype content is "${data}"`;
  return null;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const logger = createLogger(config.logsDir, 'info');
  const builder = new NovelBuilder({ config, logger, adapter: createAdapter(config) });

  const results = await builder.buildAll({ force: false, sync: true });
  let failed = 0;

  for (const r of results) {
    if (!r.epubPath) {
      console.error(`✗ ${r.book}: build produced no epub`);
      failed++;
      continue;
    }
    const buf = await readFile(r.epubPath);
    const err = checkEpubMimetype(buf);
    if (err) {
      console.error(`✗ ${r.book}: ${err} (${r.epubPath})`);
      failed++;
    } else {
      console.log(
        `✓ ${r.book} -> ${r.chapterCount} 章 | ${(buf.length / 1024).toFixed(1)} KB | synced=${r.synced} | ${r.epubPath}`,
      );
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} 本验证失败`);
    process.exitCode = 1;
  } else {
    console.log(`\n全部 ${results.length} 本验证通过`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
