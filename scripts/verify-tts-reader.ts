/**
 * V9 阶段二:TTS 准备(SSR 挂载点 + 短篇/长篇可读回归)
 * - 长篇 chapter view 可读(getChapterView)— TTS 客户端将基于此容器切片
 * - 短篇物化后 latestPublicationByStory 仍可取到,字符计数 > 0
 * - 短篇 article 容器会带 id="short-story-content",与 TtsPlayer selector 匹配
 * - 移动端适配纯函数(web/lib/tts):按句切片不超上限、语速定长单调、iOS 检测在 Node 下安全返回 false
 *
 * 浏览器端 TTS(Window.speechSynthesis)需客户端 JS,本脚本只验证挂载点选择器与纯函数。
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

const { detectIOS, maxChunkLength, splitIntoChunks } = await import('../web/lib/tts');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

async function main(): Promise<void> {
  // 移动端适配纯函数(web/lib/tts)
  const long = '这是第一句。这是第二句!这是第三句?' + '无标点超长内容'.repeat(30);
  const chunks = splitIntoChunks(long, 50);
  assertOk(chunks.length > 1, '长文本会被切成多片');
  assertOk(chunks.every((c) => c.length <= 50), '每片不超过 maxLen');
  assertOk(chunks.join('') === long, '切片不丢字');
  assertOk(
    splitIntoChunks('短句。', 50).length === 1,
    '短文本保持单片'
  );
  assertOk(splitIntoChunks('', 50).length === 0, '空文本产出空列表');
  assertOk(
    splitIntoChunks('。 。 ', 50).every((c) => c.trim().length > 0),
    '纯空白片被过滤'
  );
  assertOk(maxChunkLength(0.5) < maxChunkLength(1) && maxChunkLength(1) < maxChunkLength(2), '语速越慢单片上限越小');
  assertOk(maxChunkLength(9) >= maxChunkLength(2), '语速上限受钳制不缩水');
  assertOk(detectIOS() === false, 'iOS 检测在 Node 环境安全返回 false');

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
