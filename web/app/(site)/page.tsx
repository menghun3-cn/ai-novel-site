import Link from 'next/link';
import { cookies } from 'next/headers';
import { getSessionReader, getDiscoveryFeed, getReadingHistory, type DiscoverySection, type DiscoveryItem } from '@novel/core';
import DiscoveryCard from '@/components/DiscoveryCard';
import { READER_COOKIE } from '@/lib/reader-auth';

export const dynamic = 'force-dynamic';

async function currentUserId(): Promise<string | null> {
  try {
    const token = (await cookies()).get(READER_COOKIE)?.value;
    if (!token) return null;
    return getSessionReader(token).id;
  } catch {
    return null;
  }
}

const SECTION_GRID: Record<DiscoverySection['key'], string> = {
  today: 'grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5',
  hot: 'grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6',
  recent: 'grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6',
  new: 'grid-cols-2 gap-4 sm:grid-cols-4',
  completed: 'grid-cols-2 gap-4 sm:grid-cols-4',
  foryou: 'grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6',
};

function SectionBlock({ section }: { section: DiscoverySection }) {
  if (section.items.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-lg font-bold">{section.title}</h2>
      <div className={SECTION_GRID[section.key]}>
        {section.items.map((item) => (
          <DiscoveryCard key={`${section.key}-${item.bookId}`} item={item} />
        ))}
      </div>
    </section>
  );
}

/** 继续阅读条目(登录读者) */
function ContinueReadingSection({ userId }: { userId: string }) {
  const items = getReadingHistory(userId, 6);
  if (items.length === 0) return null;
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">继续阅读</h2>
        <Link href="/me" className="text-sm text-sky-600 hover:underline dark:text-sky-400">
          阅读历史 →
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((h) => (
          <li key={h.bookId}>
            <Link
              href={`/books/${h.slug}/chapter/${h.chapterNumber}`}
              className="flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 transition hover:border-sky-300 dark:border-neutral-800 dark:hover:border-sky-700"
            >
              <span className="min-w-0 truncate font-medium">{h.title}</span>
              <span className="shrink-0 pl-3 text-xs text-neutral-500 dark:text-neutral-400">
                第{h.chapterNumber}章 · {h.percent}%
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 今日推荐主视觉位 */
function TodayHero({ item }: { item: DiscoveryItem }) {
  return (
    <section className="mb-10 overflow-hidden rounded-2xl border border-neutral-200 bg-gradient-to-br from-sky-50 to-white dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-950">
      <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center">
        <Link href={`/books/${item.slug}`} className="block w-36 shrink-0 self-center sm:w-44 md:self-auto">
          <div className="aspect-[3/4] overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
            {item.coverPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/${item.coverPath}`} alt={item.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-5xl font-bold text-neutral-400 dark:text-neutral-600">
                {item.title.slice(0, 1)}
              </div>
            )}
          </div>
        </Link>
        <div className="flex-1 text-center md:text-left">
          <p className="text-xs font-medium tracking-widest text-sky-600 dark:text-sky-400">今日推荐</p>
          <h1 className="mt-1 text-2xl font-bold">{item.title}</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {item.authorName} · {item.categoryName} · {item.publishedCount} 章
          </p>
          {item.description && (
            <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{item.description}</p>
          )}
          <div className="mt-5">
            <Link
              href={`/books/${item.slug}/chapter/1`}
              className="inline-block rounded-full bg-sky-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              开始阅读
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const userId = await currentUserId();
  const { sections } = getDiscoveryFeed(userId ?? undefined);

  const hero = sections.find((s) => s.key === 'today')?.items[0];
  const rest: DiscoverySection[] = sections.filter((s) => s.key !== 'today' && (userId || s.key !== 'foryou'));

  const history = userId ? getReadingHistory(userId, 6) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {hero && <TodayHero item={hero} />}
      {userId && history.length > 0 && <ContinueReadingSection userId={userId} />}
      {rest.map((s) => (
        <SectionBlock key={s.key} section={s} />
      ))}

      {/* 兜底:完全无内容时引导去书库 */}
      {!hero && rest.every((s) => s.items.length === 0) && (
        <p className="py-16 text-center text-sm text-neutral-400">
          还没有可推荐的内容——先去{' '}
          <Link href="/books" className="text-sky-600 hover:underline dark:text-sky-400">
            小说库
          </Link>{' '}
          看看吧。
        </p>
      )}
    </div>
  );
}
