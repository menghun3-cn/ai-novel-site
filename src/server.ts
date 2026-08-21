/**
 * Fastify HTTP API（见方案 §17）。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import type { NovelBuilder } from './builder.js';
import type { AppConfig } from './config.js';
import { readManifest } from './manifest.js';
import { scanNovel } from './parsers/directory.js';

export async function buildServer(builder: NovelBuilder, config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => {
    return { status: 'ok', service: 'novel-builder', time: new Date().toISOString() };
  });

  // 小说列表。
  app.get('/api/books', async () => {
    const books = await builder.listBooks();
    const items = await Promise.all(
      books.map(async (b) => {
        try {
          const manifest = await readManifest(b.dir);
          const status = await builder.bookStatus(b.dir, undefined, manifest);
          return status;
        } catch {
          return { id: b.id, title: b.id, chapterCount: 0, upToDate: false, version: 0 };
        }
      }),
    );
    return { count: items.length, books: items };
  });

  // 单本书状态。
  app.get<{ Params: { id: string } }>('/api/books/:id', async (req, reply) => {
    const dir = await builder.resolveBookDir(req.params.id);
    if (!dir) return reply.code(404).send({ error: `book not found: ${req.params.id}` });
    const scanned = await scanNovel(dir);
    const manifest = await readManifest(dir);
    return await builder.bookStatus(dir, scanned, manifest);
  });

  // 构建（不强制，内容未变则跳过重建，但仍确保同步）。
  app.post<{ Body: { book: string } }>('/api/build', async (req, reply) => {
    const dir = await builder.resolveBookDir(req.body?.book ?? '');
    if (!dir) return reply.code(404).send({ error: `book not found: ${req.body?.book}` });
    try {
      const result = await builder.buildBook(dir, { force: false, sync: false });
      return { ok: true, result };
    } catch (err) {
      return reply.code(500).send({ ok: false, error: String(err) });
    }
  });

  // 强制重新构建（忽略 Manifest）。
  app.post<{ Body: { book: string } }>('/api/rebuild', async (req, reply) => {
    const dir = await builder.resolveBookDir(req.body?.book ?? '');
    if (!dir) return reply.code(404).send({ error: `book not found: ${req.body?.book}` });
    try {
      const result = await builder.buildBook(dir, { force: true, sync: false });
      return { ok: true, result };
    } catch (err) {
      return reply.code(500).send({ ok: false, error: String(err) });
    }
  });

  // 构建并同步到 Book Dock。
  app.post<{ Body: { book: string } }>('/api/sync', async (req, reply) => {
    const dir = await builder.resolveBookDir(req.body?.book ?? '');
    if (!dir) return reply.code(404).send({ error: `book not found: ${req.body?.book}` });
    try {
      const result = await builder.buildBook(dir, { force: false, sync: true });
      return { ok: true, result };
    } catch (err) {
      return reply.code(500).send({ ok: false, error: String(err) });
    }
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not found' });
  });

  return app;
}
