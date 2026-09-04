import Link from 'next/link';
import type { DiscoveryItem } from '@novel/core';
import { coverSrc } from '@/lib/cover-svg';

// V7 Discovery 板块卡片:与 BookCard 同观感,但吃 DiscoveryItem(含 reason 徽章)

export default function DiscoveryCard({ item }: { item: DiscoveryItem }) {
  return (
    <Link
      href={`/books/${item.slug}`}
      className="group block overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:shadow-black/40"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-800 dark:to-neutral-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={coverSrc(item)}
          alt={item.title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        <span
          className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs text-white ${
            item.status === 'serializing' ? 'bg-sky-600/90' : 'bg-neutral-600/90'
          }`}
        >
          {item.status === 'serializing' ? '连载中' : '完结'}
        </span>
        {item.reason && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
            {item.reason}
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="truncate font-semibold group-hover:text-sky-600 dark:group-hover:text-sky-400">{item.title}</h3>
        <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{item.authorName}</p>
        <p className="mt-1 truncate text-xs text-neutral-400 dark:text-neutral-500">
          {item.categoryName} · {item.publishedCount} 章
        </p>
      </div>
    </Link>
  );
}
