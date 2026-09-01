import { notFound } from 'next/navigation';
import { listBooks, listCategories } from '@novel/core';
import BookCard from '@/components/BookCard';

export const revalidate = 60;

/** 分类数量有限,枚举为 ISR 种子;分类增删不影响其它分类。 */
export async function generateStaticParams() {
  try {
    return listCategories().map((c) => ({ slug: c.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const cat = listCategories().find((c) => c.slug === slug);
  return { title: cat ? `${cat.name}小说` : '分类不存在' };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const cat = listCategories().find((c) => c.slug === slug);
  if (!cat) notFound();

  const books = listBooks({ categorySlug: slug });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">{cat.name}小说</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{cat.count} 本</p>

      {books.length === 0 ? (
        <p className="mt-10 text-sm text-neutral-400">该分类下还没有小说。</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {books.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      )}
    </div>
  );
}
