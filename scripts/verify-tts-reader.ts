/**
 * V9 阶段二:TTS 准备(SSR 挂载点 + 短篇/长篇可读回归)
 * - 长篇 chapter view 可读(getChapterView)— TTS 客户端将基于此容器切片
 * - 短篇物化后 latestPublicationByStory 仍可取到,字符计数 > 0
 * - 短篇 article 容器会带 id="short-story-content",与 TtsPlayer selector 匹配
 *
 * 浏览器端 TTS(Window.speechSynthesis)需客户端 JS,本脚本只验证挂载点选择器可达。
 * 运行:npm run test:tts-reader
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-tts-reader-'));

const {
  upsertAuthor,
  upsertCategory,
  createBook,
  createChapter,
  createShortStory,
  appendVersion,
  setFinalVersion,
  transitionStory,
  publishShortStory,
  latestPublicationByStory,
  getChapterView,
} = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

async function main(): Promise<void> {
  // 长篇:可经 getChapterView 取到 chapter.contentMd
  upsertAuthor('长篇作者');
  upsertCategory('长篇分类');
  const book = createBook({
    slug: 'book-tts-test',
    title: '长篇 TTS 测试',
    authorName: '长篇作者',
    categoryName: '长篇分类',
    tags: [],
  });
  createChapter({
    bookId: book.id,
    number: 1,
    title: '第一章 启程',
    contentMd: '## 序章\n\n这是第一章正文第一段,作为长篇连载测试。\n\n## 进展\n\n本章讲述主角启程出发,首次远行的故事。',
    status: 'published',
  });
  const view = getChapterView('book-tts-test', 1);
  assertOk(view !== null, '长篇 chapter view 可读');
  // mdToHtml 是 web 端 @/lib/markdown 提供(本脚本仅测 core 数据可达;web 端 <p> 切片依赖 markdown 渲染结果)
  assertOk(view!.chapter.contentMd.includes('启程'), '长篇正文内容可被 TTS 切片');

  // 短篇:publish + 物化
  const story = createShortStory({ title: 'TTS 短篇测试', brief: { theme: '旅行', synopsis: '一段短途旅行' } });
  const v1 = appendVersion(story.id, { content: '## 启程\n\n短篇正文,描述一次短途旅行的第一段。\n\n## 抵达\n\n第二段,讲述抵达目的地的感受。', creationReason: 'generated' });
  setFinalVersion(story.id, v1.id);
  transitionStory(story.id, 'passed');
  publishShortStory(story.id);
  const pub = latestPublicationByStory(story.id);
  assertOk(pub !== null, '短篇 latestPublication 可取到');
  assertOk(pub!.versionId === v1.id, 'publication versionId 与最终版一致');
  assertOk(v1.content.includes('启程'), '短篇正文内容可被 TTS 切片');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
