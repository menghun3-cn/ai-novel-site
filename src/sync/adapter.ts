/**
 * BookOrbit 同步适配器（见方案 §12）。
 *
 * 第一版实现 BookDockAdapter（投递到 Book Dock drop folder）；
 * ApiAdapter 预留 REST API 能力。
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { BookOrbitAdapter, SyncResult } from '../types.js';

/** Book Dock 投递适配器：把 EPUB 复制到 BookOrbit 自动导入目录。 */
export class BookDockAdapter implements BookOrbitAdapter {
  readonly kind = 'bookdock';

  constructor(private readonly dockDir: string) {}

  async sync(epubPath: string, _bookTitle: string): Promise<SyncResult> {
    await mkdir(this.dockDir, { recursive: true });
    const dest = join(this.dockDir, basename(epubPath));
    await copyFile(epubPath, dest);
    return { dest, syncedAt: new Date().toISOString() };
  }
}

/** REST API 适配器（预留）：第二阶段实现 BookOrbit REST API 同步。 */
export class ApiAdapter implements BookOrbitAdapter {
  readonly kind = 'api';

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async sync(_epubPath: string, _bookTitle: string): Promise<SyncResult> {
    throw new Error(
      `ApiAdapter (${this.baseUrl}) 尚未实现：第二阶段接入 BookOrbit REST API 时使用。`,
    );
  }
}

export function createAdapter(
  config: { bookdockDir: string },
): BookOrbitAdapter {
  return new BookDockAdapter(config.bookdockDir);
}
