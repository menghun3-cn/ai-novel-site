/**
 * 进程内 LRU 缓存(仅服务端使用)。
 *
 * 用途:承载热点数据。当前部署为单实例 `next start`,进程内缓存即可命中;
 * 若将来上 Redis,替换为带 TTL 的分布式缓存即可,调用方无需改动。
 *
 * 注意:纯内存、跨进程不共享、不持久化。只把「天然不可变」或「允许短 TTL
 * 陈旧」的热点放进来;会随用户/写入变化的数据务必配套失效策略(见
 * web/lib/markdown.ts 的内容寻址用法)。
 */

export interface LruCacheOptions {
  /** 最大条目数,超出会淘汰最久未使用(Least Recently Used)的条目 */
  maxSize?: number;
  /** 条目存活毫秒数;过期后读取视为未命中并剔除。缺省永不过期 */
  ttlMs?: number;
}

interface CacheEntry<V> {
  value: V;
  /** 绝对时间戳;null 表示永不过期 */
  expiresAt: number | null;
}

export class LruCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number | null;

  constructor(options: LruCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.ttlMs = options.ttlMs ?? null;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (this.ttlMs !== null && entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // LRU:访问后移到链表末尾(这里用 Map 插入顺序表示最近使用)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, {
      value,
      expiresAt: this.ttlMs !== null ? Date.now() + this.ttlMs : null,
    });
    if (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
