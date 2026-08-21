/**
 * Novel Builder 入口（见方案 §18、§24）。
 *
 * 用法：
 *   novel-builder                 # 启动 HTTP 服务 + 文件监听（长驻）
 *   novel-builder --once          # 一次性构建全部小说并投递 Book Dock
 *   novel-builder --once --book 星海余烬
 *   novel-builder --force         # 强制重建
 *   novel-builder --no-watch      # 启动服务但关闭文件监听
 */
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { NovelBuilder } from './builder.js';
import { createAdapter } from './sync/adapter.js';
import { buildServer } from './server.js';
import { startWatcher } from './watcher.js';

interface CliArgs {
  once: boolean;
  force: boolean;
  watch: boolean;
  book?: string;
  host?: string;
  port?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { once: false, force: false, watch: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once' || a === '-1') args.once = true;
    else if (a === '--force' || a === '-f') args.force = true;
    else if (a === '--no-watch') args.watch = false;
    else if (a === '--watch') args.watch = true;
    else if (a === '--book' && argv[i + 1]) args.book = argv[++i];
    else if (a === '--host' && argv[i + 1]) args.host = argv[++i];
    else if (a === '--port' && argv[i + 1]) args.port = Number(argv[++i]);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const logger = createLogger(config.logsDir, 'info');
  const adapter = createAdapter(config);
  const builder = new NovelBuilder({ config, logger, adapter });

  logger.info(
    {
      root: config.root,
      novelsDir: config.novelsDir,
      outputDir: config.outputDir,
      bookdockDir: config.bookdockDir,
      syncEnabled: config.sync.enabled,
      watchEnabled: config.watch.enabled,
    },
    'Novel Builder starting',
  );

  // 一次性构建模式。
  if (args.once) {
    if (args.book) {
      const dir = await builder.resolveBookDir(args.book);
      if (!dir) {
        logger.error({ book: args.book }, 'book not found');
        process.exitCode = 1;
        return;
      }
      const result = await builder.buildBook(dir, { force: args.force, sync: true });
      logger.info({ result }, 'build complete');
    } else {
      const results = await builder.buildAll({ force: args.force, sync: true });
      logger.info(
        {
          total: results.length,
          built: results.filter((r) => r.changed).length,
          synced: results.filter((r) => r.synced).length,
        },
        'build all complete',
      );
    }
    return;
  }

  // 长驻模式：先追赶一次（重启后不丢失未处理的变化），再启动服务与监听。
  await builder.buildAll({ sync: true });
  const server = await buildServer(builder, config);
  const host = args.host ?? config.server.host;
  const port = args.port ?? config.server.port;
  await server.listen({ host, port });
  logger.info({ host, port }, 'HTTP server listening');

  let watcher = null;
  if (config.watch.enabled && args.watch) {
    watcher = startWatcher(config, builder, logger);
    logger.info({ novelsDir: config.novelsDir }, 'file watcher started');
  }

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down...');
    if (watcher) await watcher.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
