/**
 * 文件监控与自动构建（见方案 §13、§14）。
 *
 * - chokidar 监听 novels/ 下所有文件。
 * - 防抖（debounce）合并高频事件。
 * - 稳定性检查（size/mtime 快照一致才构建），避免读到未写完的文件。
 * - 任务队列去重。
 */
import { watch, type FSWatcher } from 'chokidar';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import type { NovelBuilder } from './builder.js';
import type { AppConfig } from './config.js';
import { BuildQueue } from './queue.js';
import { sleep } from './util.js';
import { isChapterFile } from './parsers/directory.js';

const WATCH_EXTS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);

function novelIdFor(config: AppConfig, filePath: string): string | null {
  const rel = relative(config.novelsDir, filePath);
  if (rel.startsWith('..') || rel === '') return null;
  const first = rel.split(/[\\/]/)[0];
  return first || null;
}

/** 对一本小说目录内的文件计算 size+mtime 快照哈希。 */
async function snapshot(config: AppConfig, novelDir: string): Promise<string> {
  const files = await collectFiles(config, novelDir);
  const hash = createHash('sha256');
  for (const f of files) {
    const s = await stat(f).catch(() => null);
    hash.update(`${relative(novelDir, f)}|${s?.size ?? -1}|${s?.mtimeMs ?? -1}\n`);
  }
  return hash.digest('hex');
}

async function collectFiles(config: AppConfig, novelDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === '.manifest.json') continue;
      if (e.name.endsWith('.tmp')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const ext = e.name.slice(e.name.lastIndexOf('.')).toLowerCase();
        if (WATCH_EXTS.has(ext) || isChapterFile(e.name)) out.push(full);
      }
    }
  }
  await walk(novelDir);
  return out;
}

export function startWatcher(config: AppConfig, builder: NovelBuilder, logger: Logger): FSWatcher {
  const queue = new BuildQueue(async (id) => {
    const dir = await builder.resolveBookDir(id);
    if (!dir) return;
    await builder.buildBook(dir, { sync: true });
  }, logger);

  const debounceTimers = new Map<string, NodeJS.Timeout>();

  const schedule = (id: string): void => {
    const existing = debounceTimers.get(id);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      id,
      setTimeout(() => {
        debounceTimers.delete(id);
        void handleChange(id);
      }, config.watch.debounceMs),
    );
  };

  const handleChange = async (id: string): Promise<void> => {
    const dir = join(config.novelsDir, id);
    // 首次等待，让写入方完成。
    await sleep(config.watch.stabilityCheckMs);
    const s1 = await snapshot(config, dir).catch(() => null);
    await sleep(config.watch.stabilityIntervalMs);
    const s2 = await snapshot(config, dir).catch(() => null);
    if (s1 === null || s2 === null || s1 !== s2) {
      // 文件仍在变化，稍后再试。
      schedule(id);
      return;
    }
    queue.enqueue(id);
  };

  // chokidar v4 已移除 glob 支持，直接监听目录（默认递归监听全部子内容）。
  const watcher = watch(config.novelsDir, {
    persistent: true,
    ignoreInitial: true,
    ignored: (p: string) => {
      const base = basename(p);
      if (base === '.manifest.json') return true;
      if (base.endsWith('.tmp')) return true;
      if (base.startsWith('.')) return true;
      return false;
    },
  });

  watcher.on('add', (p) => {
    const id = novelIdFor(config, p);
    if (id) schedule(id);
  });
  watcher.on('change', (p) => {
    const id = novelIdFor(config, p);
    if (id) schedule(id);
  });
  watcher.on('unlink', (p) => {
    const id = novelIdFor(config, p);
    if (id) schedule(id);
  });
  watcher.on('error', (err) => {
    // 打印而不崩溃。
    console.error('[watcher]', err);
  });

  return watcher;
}
