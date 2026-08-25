import Link from 'next/link';
import type { DiscoveryItem } from '@novel/core';
import { formatRelativeTime } from '@/lib/format';

// 最新更新 = 更新流列表形态。用户任务是「追更」:
// 每行回答三件事——哪本书、更到第几章、多久前更新的;时间右对齐便于纵向扫描。

export default function RecentUpdates({ items }: { items: DiscoveryItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      {items.map((item) => (
        <li key={item.bookId}>
          <Link
            href={`/books/${item.slug}`}
            className="group flex items-center gap-3 px-4 py-3 transition first:rounded-t-xl last:rounded-b-xl hover:bg-neutral-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-500 dark:hover:bg-neutral-800/60"
          >
            <div className="h-[60px] w-[45px] shrink-0 overflow-hidden rounded-md bg-neutral-200 dark:bg-neutral-800">
              {item.coverPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/${item.coverPath}`} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-lg font-bold text-neutral-400 dark:text-neutral-600">
                  {item.title.slice(0, 1)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2">
                <span className="truncate text-sm font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400">
                  {item.title}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-px text-[11px] ${
                    item.status === 'serializing'
                      ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300'
                      : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                  }`}
                >
                  {item.status === 'serializing' ? '连载中' : '完结'}
                </span>
              </p>
              <p className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                {item.latestChapterNumber ? `更新至第${item.latestChapterNumber}章 · ` : ''}
                {item.categoryName} · 共{item.publishedCount}章
              </p>
            </div>
            <time
              dateTime={item.lastPublishedAt ?? undefined}
              className="shrink-0 pl-3 text-xs tabular-nums text-neutral-400 dark:text-neutral-500"
            >
              {formatRelativeTime(item.lastPublishedAt)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}
