import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBookBySlug, listBooks, listPublishedChapters, getBookStats } from '@novel/core';
import ContinueReading from '@/components/ContinueReading';
import ChapterList from '@/components/ChapterList';
import BookActions from '@/components/BookActions';
import { coverSrc } from '@/lib/cover-svg';
import { chapterLabel } from '@/lib/format';

// ISR:书籍详情(元信息+章节列表)较稳定,配合发布时 revalidatePath 及时刷新最新章节/热度。
export const revalidate = 60;

/** 动态路由需配合 generateStaticParams 才会真正启用 ISR;枚举公开书 slug。 */
export async function generateStaticParams() {
  try {
    return listBooks({ limit: 100 }).map((b) => ({ slug: b.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = getBookBySlug(slug);
  return {
    title: book?.title ?? '小说不存在',
    description: book?.description ?? undefined,
  };
}

export default async function BookDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const book = getBookBySlug(slug);
  if (!book) notFound();

  const chapters = listPublishedChapters(book.id);
  const first = chapters[0];
  const latest = chapters[chapters.length - 1];

  // 序列化章节数据供客户端组件使用
  const chapterData = chapters.map((ch) => ({
    id: ch.id,
    number: ch.number,
    title: ch.title,
    publishedAt: ch.publishedAt,
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <div className="flex flex-col gap-6 md:flex-row">
        {/* 封面 */}
        <div className="w-36 shrink-0 self-center sm:w-44 md:self-auto">
          <div className="aspect-[3/4] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverSrc(book)} alt={book.title} className="h-full w-full object-cover" />
          </div>
        </div>

        {/* 信息 */}
        <div className="flex-1 text-center md:text-left">
          <h1 className="text-2xl font-bold sm:text-3xl">{book.title}</h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            {book.authorName} · {book.categoryName} ·{' '}
            {book.status === 'serializing' ? '连载中' : '已完结'} · {chapters.length} 章
          </p>
          <BookStatsLine bookId={book.id} />
          {book.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2 md:justify-start">
              {book.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {book.description && (
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-neutral-600 dark:text-neutral-300">
              {book.description}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3 md:justify-start">
            {first && (
              <Link
                href={`/books/${book.slug}/chapter/${first.number}`}
                className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500 active:scale-95 sm:px-6"
              >
                开始阅读
              </Link>
            )}
            <ContinueReading bookSlug={book.slug} latestNumber={latest?.number ?? null} />
            <BookActions slug={book.slug} />
          </div>
        </div>
      </div>

      {/* 章节列表（支持正序/倒序） */}
      <ChapterList bookSlug={book.slug} chapters={chapterData} />
    </div>
  );
}

/** V7 热度行:PV · 收藏 · 完读率(无信号时整行不渲染) */
function BookStatsLine({ bookId }: { bookId: string }) {
  const st = getBookStats(bookId);
  if (st.viewCount === 0 && st.favoriteCount === 0) return null;
  return (
    <p className="mt-1.5 text-xs text-neutral-400 dark:text-neutral-500">
      {st.viewCount} 次阅读 · {st.favoriteCount} 人收藏
      {st.finishRate > 0 ? ` · 完读率 ${Math.round(st.finishRate * 100)}%` : ''}
    </p>
  );
}
