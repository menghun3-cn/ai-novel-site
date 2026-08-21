import Link from 'next/link';
import type { BookWithMeta } from '@novel/core';

export default function BookCard({ book }: { book: BookWithMeta }) {
  return (
    <Link
      href={`/books/${book.slug}`}
      className="group block overflow-hidden rounded-xl border border-neutral-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:shadow-black/40"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-800 dark:to-neutral-900">
        {book.coverPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/${book.coverPath}`}
            alt={book.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl font-bold text-neutral-400 dark:text-neutral-600">
            {book.title.slice(0, 1)}
          </div>
        )}
        <span
          className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs text-white ${
            book.status === 'serializing' ? 'bg-sky-600/90' : 'bg-neutral-600/90'
          }`}
        >
          {book.status === 'serializing' ? '连载中' : '完结'}
        </span>
      </div>
      <div className="p-3">
        <h3 className="truncate font-semibold group-hover:text-sky-600 dark:group-hover:text-sky-400">
          {book.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{book.authorName}</p>
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          {book.publishedCount} 章
          {book.latestChapterNumber ? ` · 至第${book.latestChapterNumber}章` : ''}
        </p>
      </div>
    </Link>
  );
}
