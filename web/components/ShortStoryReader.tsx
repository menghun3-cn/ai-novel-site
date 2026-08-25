'use client';

import Link from 'next/link';
import type { BookWithMeta, ShortStory, ShortStoryPublication } from '@novel/core';
import { useMemo } from 'react';

export default function ShortStoryReader({
  book,
  story,
  publication,
  html,
}: {
  book: BookWithMeta;
  story: ShortStory;
  publication: ShortStoryPublication;
  html: string;
}) {
  const publishedDate = useMemo(() => new Date(publication.publishedAt).toLocaleDateString('zh-CN'), [publication.publishedAt]);
  return (
    <article className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <nav className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        <Link href="/" className="hover:text-sky-600">首页</Link>
        <span className="mx-2">/</span>
        <Link href={`/books/${book.slug}`} className="hover:text-sky-600">短篇</Link>
        <span className="mx-2">/</span>
        <span className="text-neutral-700 dark:text-neutral-300">{story.title}</span>
      </nav>

      <header className="mb-6 border-b border-neutral-200 pb-6 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            短篇
          </span>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {book.categoryName}
          </span>
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">{story.title}</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          {book.authorName} · 发布于 {publishedDate} · {story.title}
        </p>
        {book.description && (
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {book.description}
          </p>
        )}
      </header>

      <div
        className="prose prose-neutral max-w-none dark:prose-invert prose-p:leading-loose prose-p:my-4"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <footer className="mt-10 border-t border-neutral-200 pt-6 text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        <p>
          读完这篇短篇?
          <Link href={`/books/${book.slug}`} className="ml-1 text-sky-600 hover:underline">
            查看更多长篇作品
          </Link>
        </p>
      </footer>
    </article>
  );
}
