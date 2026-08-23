// V6 CDP 审计种子:一本书两章已发布
import fs from 'node:fs';
process.env.NOVEL_DATA_DIR = process.env.SEED_DATA_DIR!;
const { createBook, createChapter, submitChapterForReview, approveChapter } = await import('@novel/core');
const book = createBook({ slug: 'audit-book', title: '审计之书', authorName: '审者', categoryName: '科幻', tags: ['热血'], description: '用于端到端审计的测试书' });
for (const num of [1, 2]) {
  createChapter({ bookId: book.id, number: num, title: `章节${num}`, contentMd: `# 章节${num}\n\n${'正文内容。'.repeat(500)}` });
  submitChapterForReview(book.id, num);
  approveChapter(book.id, num, { mode: 'now' });
}
console.log('seeded', book.slug);
process.exit(0);
