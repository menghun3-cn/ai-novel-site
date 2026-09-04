import { notFound } from 'next/navigation';
import { listBooks, listCategories } from '@novel/core';
import CategoryBrowser from '@/components/CategoryBrowser';

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
  return { title: cat ? (cat.name.endsWith('小说') ? cat.name : `${cat.name}小说`) : '分类不存在' };
}

/** ISR 静态页:kind 筛选由客户端组件完成,切换零服务端往返(避免 Next 15 searchParams 退化 dynamic) */
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const cat = listCategories().find((c) => c.slug === slug);
  if (!cat) notFound();

  const books = listBooks({ categorySlug: slug, limit: 500 });

  return <CategoryBrowser cat={cat} books={books} />;
}
