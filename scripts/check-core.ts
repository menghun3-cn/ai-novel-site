// Content Core 数据验证脚本:导入后运行 npm run check:core

import process from 'node:process';
import {
  getBookBySlug,
  getChapterView,
  getDbPath,
  latestUpdates,
  listBooks,
  listCategories,
  listPublishedChapters,
  rssItems,
  searchBooks,
} from '@novel/core';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

function main(): void {
  console.log(`数据库: ${getDbPath()}\n`);

  const books = listBooks();
  check('listBooks 非空', books.length > 0, `${books.length} 本`);

  const book = getBookBySlug('xing-hai-yu-jin');
  if (book) {
    check(
      '星海余烬 存在',
      true,
      `${book.chapterCount} 章 / ${book.publishedCount} 已发布 / 作者 ${book.authorName} / 分类 ${book.categoryName} / 标签 ${book.tags.join('、')}`
    );
    const chapters = listPublishedChapters(book.id);
    check('已发布章节数一致', chapters.length === book.publishedCount, `${chapters.length} 章`);

    let chainOk = chapters.length > 0;
    for (const ch of chapters) {
      const view = getChapterView(book.slug, ch.number);
      if (!view) {
        chainOk = false;
        break;
      }
      if (ch.number > 1 && (!view.prev || view.prev.number !== ch.number - 1)) {
        chainOk = false;
        break;
      }
      if (view.next && view.next.number !== ch.number + 1) {
        chainOk = false;
        break;
      }
    }
    check('上一章/下一章链条正确', chainOk, `${chapters.length} 章连通`);

    const first = getChapterView(book.slug, 1);
    check('首章无上一章', first !== null && first.prev === null);
    const last = getChapterView(book.slug, chapters[chapters.length - 1]?.number ?? 0);
    check('末章无下一章', last !== null && last.next === null);
    check('首章正文非空', (first?.chapter.contentMd.length ?? 0) > 0, `${first?.chapter.contentMd.length ?? 0} 字`);
    check('首章标题', first?.chapter.title === '第一章 余烬', first?.chapter.title ?? '');
  } else {
    check('星海余烬 存在', false, '未找到 xing-hai-yu-jin,请先导入');
  }

  const cats = listCategories();
  check('分类计数', cats.length > 0, cats.map((c) => `${c.name}(${c.count})`).join(' '));

  const s = searchBooks('星海');
  check('搜索「星海」命中', s.some((b) => b.slug === 'xing-hai-yu-jin'), `${s.length} 条`);

  const ups = latestUpdates(5);
  check(
    '最新更新',
    ups.length > 0,
    ups.map((u) => `${u.bookTitle} 第${u.chapter.number}章`).join(' / ')
  );

  const rss = rssItems(5);
  check('RSS 条目', rss.length > 0, `${rss.length} 条`);

  console.log(failures === 0 ? '\n🎉 全部检查通过' : `\n❌ ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
