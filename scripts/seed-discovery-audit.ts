// V7-PR39 首页 Discovery 审计种子:3 本不同热度的书
import fs from 'node:fs';
process.env.NOVEL_DATA_DIR = process.env.SEED_DATA_DIR!;
const { createBook, createChapter, submitChapterForReview, approveChapter, getDb } = await import('@novel/core');

function seed(slug, title, category, chapters, status, daysAgoCreated, daysAgoPublished) {
  const book = createBook({ slug, title, authorName: '测', categoryName: category, tags: [] });
  for (let i = 0; i < chapters; i++) {
    createChapter({ bookId: book.id, number: i + 1, title: `第${i + 1}章`, contentMd: `# 第${i + 1}章\n\n` + '正文'.repeat(400) });
    submitChapterForReview(book.id, i + 1);
    approveChapter(book.id, i + 1, { mode: 'now' });
  }
  const db = getDb();
  db.prepare('UPDATE books SET created_at = ? WHERE id = ?').run(new Date(Date.now() - daysAgoCreated * 86400000).toISOString(), book.id);
  db.prepare('UPDATE chapters SET published_at = ? WHERE book_id = ?').run(new Date(Date.now() - daysAgoPublished * 86400000).toISOString(), book.id);
  if (status === 'completed') db.prepare('UPDATE books SET status = ? WHERE id = ?').run('completed', book.id);
  return book;
}

seed('v-hot', '热门之书', '科幻', 3, 'serializing', 100, 1);
seed('v-stale', '沉寂之书', '都市', 1, 'serializing', 200, 90);
seed('v-done', '完结好书', '科幻', 2, 'completed', 300, 30);
console.log('seeded');
process.exit(0);
