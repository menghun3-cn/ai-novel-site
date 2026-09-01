import { revalidatePath } from 'next/cache';
import { getBookById, latestPublicationByStory, listPublishedChapters } from '@novel/core';

/**
 * 公开阅读路径的主动缓存失效(仅在 web 进程内有效)。
 *
 * 由「通过 web 容器内 API 的写入」调用,让读者下次访问即见新内容:
 *  - 章节被二次编辑/发布 → 失效该章节页 + 书详情页(章节列表/标题可能变)。
 *  - 调度器容器直写 SQLite 的发布不经此路径,只能靠页面自身的 ISR revalidate 兜底。
 *
 * 书不存在或处于隐藏状态时,其公开页本就不该可访问,静默跳过即可。
 */
export function revalidateBookChapter(bookId: string, chapterNumber: number | string): void {
  const book = getBookById(bookId);
  if (!book) return;
  revalidatePath(`/books/${book.slug}`);
  revalidatePath(`/books/${book.slug}/chapter/${chapterNumber}`);
}

/** 只需失效书详情页(章节列表/元信息变化,不涉及某单章正文)。 */
export function revalidateBook(bookId: string): void {
  const book = getBookById(bookId);
  if (!book) return;
  revalidatePath(`/books/${book.slug}`);
}

/**
 * 失效某个短篇的公开页及其发布书籍的页面。
 * 短篇发布后作为一本书(books/short-*)呈现,故同时失效:
 *  - /short/[id]      短篇专属阅读页
 *  - /books/[slug]    作为书的详情页
 *  - /books/[slug]/chapter/[n]  书内章节(短篇通常单章)
 * 未发布/书已被隐藏等场景静默跳过(仅保留 /short 失效)。
 */
export function revalidateShortStory(storyId: string): void {
  revalidatePath(`/short/${storyId}`);
  try {
    const pub = latestPublicationByStory(storyId);
    if (!pub?.bookId) return;
    const book = getBookById(pub.bookId);
    if (!book) return;
    revalidatePath(`/books/${book.slug}`);
    try {
      for (const ch of listPublishedChapters(pub.bookId)) {
        revalidatePath(`/books/${book.slug}/chapter/${ch.number}`);
      }
    } catch {
      /* 章节查询失败不影响短篇页失效 */
    }
  } catch {
    /* 未发布/不存在:仅失效 /short 路径 */
  }
}
