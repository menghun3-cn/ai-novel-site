/**
 * 配置加载：读取 config/config.yaml，填充默认值，解析为绝对路径。
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 项目根目录：package.json 所在目录（src/ 的上一级）。 */
export const PROJECT_ROOT = resolve(__dirname, '..');

const LibrarySchema = z.object({
  novelsDir: z.string().default('novels'),
  outputDir: z.string().default('output'),
  bookdockDir: z.string().default('bookdock'),
  logsDir: z.string().default('logs'),
});

const ServerSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().min(1).max(65535).default(8320),
});

const WatchSchema = z.object({
  enabled: z.boolean().default(true),
  debounceMs: z.coerce.number().int().min(0).default(500),
  stabilityCheckMs: z.coerce.number().int().min(0).default(2000),
  stabilityIntervalMs: z.coerce.number().int().min(0).default(400),
});

const SyncSchema = z.object({
  enabled: z.boolean().default(true),
  retries: z.coerce.number().int().min(0).default(3),
  retryDelayMs: z.coerce.number().int().min(0).default(1000),
});

const ConfigSchema = z.object({
  library: LibrarySchema.default({}),
  server: ServerSchema.default({}),
  watch: WatchSchema.default({}),
  sync: SyncSchema.default({}),
});

export interface AppConfig {
  /** 项目根目录（绝对路径）。 */
  root: string;
  configPath: string;
  novelsDir: string;
  outputDir: string;
  bookdockDir: string;
  logsDir: string;
  server: { host: string; port: number };
  watch: {
    enabled: boolean;
    debounceMs: number;
    stabilityCheckMs: number;
    stabilityIntervalMs: number;
  };
  sync: { enabled: boolean; retries: number; retryDelayMs: number };
}

function resolvePath(root: string, p: string): string {
  return isAbsolute(p) ? p : resolve(root, p);
}

export async function loadConfig(
  opts: { root?: string; configPath?: string } = {},
): Promise<AppConfig> {
  const root = opts.root ?? PROJECT_ROOT;
  const configPath = opts.configPath ?? resolve(root, 'config', 'config.yaml');

  let raw: unknown = {};
  try {
    const text = await readFile(configPath, 'utf8');
    raw = (parse(text) ?? {}) as unknown;
  } catch {
    // 无配置文件时使用默认值。
  }

  const parsed = ConfigSchema.parse(raw);

  // 数据根目录：容器内通过环境变量 NOVEL_LIBRARY_ROOT 指向挂载的数据卷，
  // 否则与项目根目录一致（本地运行）。
  const dataRoot = process.env.NOVEL_LIBRARY_ROOT
    ? resolve(process.env.NOVEL_LIBRARY_ROOT)
    : root;

  const novelsDir = resolvePath(dataRoot, parsed.library.novelsDir);
  const outputDir = resolvePath(dataRoot, parsed.library.outputDir);
  // bookdock 可单独覆盖：BookOrbit 原生跑在宿主机时，直接写入其图书目录。
  // 例：NOVEL_BOOKDOCK_DIR=/home/app/bookorbit/books
  const bookdockDir = resolvePath(
    dataRoot,
    process.env.NOVEL_BOOKDOCK_DIR ?? parsed.library.bookdockDir,
  );
  const logsDir = resolvePath(dataRoot, parsed.library.logsDir);

  // 确保基础目录存在。
  for (const dir of [novelsDir, outputDir, bookdockDir, logsDir]) {
    await mkdir(dir, { recursive: true });
  }

  return {
    root,
    configPath,
    novelsDir,
    outputDir,
    bookdockDir,
    logsDir,
    server: { host: parsed.server.host, port: parsed.server.port },
    watch: { ...parsed.watch },
    sync: { ...parsed.sync },
  };
}
