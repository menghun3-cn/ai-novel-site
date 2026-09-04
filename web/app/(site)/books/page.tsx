import { listBooks, listCategories } from '@novel/core';
import BooksBrowser from '@/components/BooksBrowser';

export const revalidate = 60;

export const metadata = { title: '全部小说' };

/**
 * ISR 静态页:服务端一次取全量公开书籍与分类统计,筛选在客户端完成。
 * 不读取 searchParams(否则 Next 15 会退化为 dynamic,每次请求重渲染),
 * 初始筛选由 BooksBrowser 在客户端从 URL 读取。
 */
export default function BooksPage() {
  const books = listBooks({ limit: 500 });
  const cats = listCategories();

  return <BooksBrowser books={books} cats={cats} />;
}
