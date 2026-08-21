// 生成 100 章测试小说目录 novels/深海回响,用于验收
// 用法: npm run seed:100 → npm run import:novel -- novels/深海回响

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TITLE = '深海回响';
const SLUG = 'shen-hai-hui-xiang';
const dir = path.resolve(process.cwd(), 'novels', TITLE);
const chaptersDir = path.join(dir, 'chapters');

const CHAPTER_TITLES = [
  '潮声', '沉默的鲸', '下潜', '裂缝', '回声', '暗流', '浮标', '深渊', '光斑', '残骸',
  '气压', '洋流', '方舟', '静默', '边界', '黑水', '微光', '坐标', '归航', '记忆',
];

const SENTENCES = [
  '加压舱的门缓缓合拢，灯光依次熄灭，只剩下仪表盘上跳动的数字。',
  '她把手掌贴在观察窗上，冰冷的玻璃另一侧，是无尽的黑蓝色。',
  '通讯频道里只剩下电流的杂音，像是深海里某种生物的低语。',
  '深度计的指针滑过三位数，压力表的读数仍在缓慢爬升。',
  '这艘潜艇已经在这片海域航行了一百零三天，所有人都沉默着。',
  '航向修正完成，系统提示音在狭窄的舱室里显得格外清晰。',
  '地图上的标记已经模糊，他们正在驶向一片从未被记录的暗区。',
  '他闭上眼，想象着海面之上的阳光，想象着已经回不去的陆地。',
  '警报声骤然响起，红色的光扫过每个人的脸。',
  '没有人说话，但所有人都知道，真正的考验才刚刚开始。',
];

function makeChapter(n: number, title: string): string {
  const lines: string[] = [`# 第${n}章 ${title}`, ''];
  const base = (n * 7) % SENTENCES.length;
  for (let p = 0; p < 8; p++) {
    lines.push(SENTENCES[(base + p) % SENTENCES.length]);
    lines.push('');
  }
  return lines.join('\n');
}

function main(): void {
  fs.mkdirSync(chaptersDir, { recursive: true });
  const bookYaml = [
    `title: ${TITLE}`,
    `slug: ${SLUG}`,
    'author: AI文学实验室',
    'category: 科幻',
    'tags:',
    '  - 深海',
    '  - 悬疑',
    '  - AI小说',
    'description: 一艘深海潜艇在未知海域的漫长航行，和来自深渊的回响。',
    'status: serializing',
    'chapterStatus: published',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'book.yaml'), bookYaml, 'utf-8');

  for (let n = 1; n <= 100; n++) {
    const title =
      CHAPTER_TITLES[(n - 1) % CHAPTER_TITLES.length] +
      (n > 20 ? `·${Math.floor((n - 1) / 20) + 1}` : '');
    fs.writeFileSync(
      path.join(chaptersDir, `${String(n).padStart(3, '0')}.md`),
      makeChapter(n, title),
      'utf-8'
    );
  }

  console.log(`✅ 已生成 ${dir} (100 章)`);
  console.log('下一步: npm run import:novel -- novels/深海回响');
}

main();
