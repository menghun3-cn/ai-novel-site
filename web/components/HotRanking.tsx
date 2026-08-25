import Link from 'next/link';
import { Eye, Flame, Star } from 'lucide-react';
import type { DiscoveryItem } from '@novel/core';
import { formatCount } from '@/lib/format';

// 热门小说 = 排行榜形态:第 1 名做主视觉位,2-6 名做紧凑排名行。
// 排名数字承载「热」的语义,人气值(PV)提供可信度依据。

function CoverThumb({ item, className }: { item: DiscoveryItem; className: string }) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-md bg-neutral-200 dark:bg-neutral-800 ${className}`}>
      {item.coverPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/${item.coverPath}`} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-lg font-bold text-neutral-400 dark:text-neutral-600">
          {item.title.slice(0, 1)}
        </div>
      )}
    </div>
  );
}

function rankClass(rank: number): string {
  if (rank === 1) return 'text-amber-500';
  if (rank === 2) return 'text-neutral-400 dark:text-neutral-500';
  if (rank === 3) return 'text-orange-600 dark:text-orange-500';
  return 'text-neutral-300 dark:text-neutral-700';
}

/** 第 1 名主视觉卡 */
function FeaturedCard({ item }: { item: DiscoveryItem }) {
  return (
    <Link
      href={`/books/${item.slug}`}
      className="group flex gap-4 rounded-xl border border-neutral-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-sky-700 dark:hover:shadow-black/40"
    >
      <CoverThumb item={item} className="aspect-[3/4] w-28 sm:w-32" />
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-500">
          <Flame aria-hidden="true" size={14} />
          人气第 1 名
        </p>
        <h3 className="mt-1 truncate text-base font-bold group-hover:text-sky-600 sm:text-lg dark:group-hover:text-sky-400">
          {item.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
          {item.authorName} · {item.categoryName} · {item.publishedCount} 章
        </p>
        {item.description && (
          <p className="mt-2 hidden text-xs leading-5 text-neutral-400 line-clamp-2 sm:block dark:text-neutral-500">
            {item.description}
          </p>
        )}
        <p className="mt-2 flex items-center gap-4 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="flex items-center gap-1" title="累计阅读量">
            <Eye aria-hidden="true" size={14} />
            {formatCount(item.viewCount)}
          </span>
          <span className="flex items-center gap-1" title="收藏数">
            <Star aria-hidden="true" size={14} />
            {formatCount(item.favoriteCount)}
          </span>
        </p>
      </div>
    </Link>
  );
}

/** 2 名以后的紧凑排名行 */
function RankRow({ item, rank }: { item: DiscoveryItem; rank: number }) {
  return (
    <li>
      <Link
        href={`/books/${item.slug}`}
        className="group flex items-center gap-3 rounded-lg py-2 pr-2 transition hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:hover:bg-neutral-800/60"
      >
        <span aria-label={`第${rank}名`} className={`w-7 shrink-0 text-center text-lg font-bold tabular-nums ${rankClass(rank)}`}>
          {rank}
        </span>
        <CoverThumb item={item} className="h-[60px] w-[45px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:text-sky-600 dark:group-hover:text-sky-400">
            {item.title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-neutral-400 dark:text-neutral-500">
            {item.authorName} · {item.categoryName}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 pl-2 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
          <Eye aria-hidden="true" size={13} />
          {formatCount(item.viewCount)}
        </span>
      </Link>
    </li>
  );
}

export default function HotRanking({ items }: { items: DiscoveryItem[] }) {
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  return (
    <div className="grid gap-4 lg:grid-cols-[5fr_7fr] lg:gap-6">
      <FeaturedCard item={first} />
      <ol className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {rest.map((item, i) => (
          <RankRow key={item.bookId} item={item} rank={i + 2} />
        ))}
      </ol>
    </div>
  );
}
