/**
 * 简单的内存任务队列：去重 + 串行执行（见方案 §13）。
 */
import type { Logger } from 'pino';

export class BuildQueue {
  private queue: string[] = [];
  private pending = new Set<string>();
  private draining = false;

  constructor(
    private readonly worker: (id: string) => Promise<void>,
    private readonly logger: Logger,
  ) {}

  enqueue(id: string): void {
    if (this.pending.has(id)) return;
    this.pending.add(id);
    this.queue.push(id);
    this.logger.debug({ book: id, queueLength: this.queue.length }, 'build enqueued');
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const id = this.queue.shift()!;
        this.pending.delete(id);
        try {
          await this.worker(id);
        } catch (err) {
          this.logger.error({ err, book: id }, 'build worker failed');
        }
      }
    } finally {
      this.draining = false;
    }
  }

  get size(): number {
    return this.queue.length;
  }
}
