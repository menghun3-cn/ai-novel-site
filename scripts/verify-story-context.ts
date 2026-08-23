/**
 * V4 生成上下文组装器验证:下一章号推导、目标章冲突守卫、
 * 大纲拾取、openOnly 伏笔、done 故事线过滤、最近章节摘录截断、提示词确定性。
 *
 * 运行:npm run test:story-context
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-ctx-'));

const {
  CoreError,
  createBook,
  createChapter,
  getGenerationContext,
  renderGenerationPrompt,
  upsertWorld,
  upsertCharacter,
  addRelationship,
  createArc,
  updateArc,
  setOutline,
  plantForeshadowing,
  resolveForeshadowing,
} = await import('@novel/core');

let failed = 0;

function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

const book = createBook({ slug: 'ctx-book', title: '长夜之火', authorName: '测', categoryName: '奇幻', tags: [] });

// 空书:全默认上下文
{
  const ctx = getGenerationContext(book.id);
  assertOk(ctx.nextChapterNumber === 1 && ctx.outline === null && ctx.recentChapters.length === 0, '空书:章号=1,无大纲无近章');
  assertOk(ctx.world.setting === '' && ctx.characters.length === 0 && ctx.openForeshadowing.length === 0, '空书:事实全空');
  const prompt = renderGenerationPrompt(ctx);
  assertOk(prompt.includes('第 1 章') && prompt.includes('无既定大纲'), '空书提示词含任务与无大纲说明');
}

// 铺设事实 + 章节
upsertWorld(book.id, { setting: '永夜大陆,火种即货币', rules: '每章两千字;禁止现代词汇' });
upsertCharacter(book.id, { name: '燃', role: 'protagonist', persona: '执拗', state: '失去火种' });
upsertCharacter(book.id, { name: '灰烬', role: 'antagonist', state: '蛰伏' });
addRelationship(book.id, { fromName: '燃', toName: '灰烬', kind: '宿命之敌' });
createChapter({ bookId: book.id, title: '熄灭之夜', contentMd: `开篇。${'夜'.repeat(800)}`, status: 'published' });
createChapter({ bookId: book.id, title: '残烛', contentMd: '第二段旅程的开始。', status: 'published' });
setOutline(book.id, { number: 3, title: '寻火', beats: '- 进入灰烬集市\n- 发现火种线索' });
plantForeshadowing(book.id, { label: '半枚火印', detail: '第1章老人所赠', plantedChapter: 1 });
plantForeshadowing(book.id, { label: '灰烬的低语', plantedChapter: 2 });
resolveForeshadowing(book.id, 2, 3);

{
  const ctx = getGenerationContext(book.id);
  assertOk(ctx.nextChapterNumber === 3, `默认章号 = 最大+1(实得 ${ctx.nextChapterNumber})`);
  assertOk(ctx.bookTitle === '长夜之火' && ctx.world.setting.includes('火种'), '世界观并入上下文');
  assertOk(ctx.characters.length === 2 && ctx.characters[0].state === '失去火种', '人物及状态并入');
  assertOk(ctx.relationships.length === 1 && ctx.relationships[0].kind === '宿命之敌', '关系并入');
  assertOk(ctx.arcs.length === 0, '无故事线时不虚造');

  assertOk(ctx.openForeshadowing.length === 1 && ctx.openForeshadowing[0].label === '半枚火印', '已回收伏笔被过滤');

  assertOk(ctx.recentChapters.length === 2 && ctx.recentChapters[1].title === '残烛', '近章按正序排列');
  assertOk(
    ctx.recentChapters[0].excerpt.startsWith('…') && ctx.recentChapters[0].excerpt.length === 601,
    `超长正文尾部截断至 600+省略号(实得 ${ctx.recentChapters[0].excerpt.length})`
  );
  assertOk(ctx.recentChapters[1].excerpt === '第二段旅程的开始。', '短正文原样保留');

  assertOk(ctx.outline !== null && ctx.outline.title === '寻火', '拾取目标章大纲');
}

// 指定章号 + 冲突守卫 + recentCount=0
{
  const ctx = getGenerationContext(book.id, { chapterNumber: 5, recentCount: 1 });
  assertOk(ctx.nextChapterNumber === 5 && ctx.outline === null, '指定章号生效且无该号大纲');
  assertOk(ctx.recentChapters.length === 1 && ctx.recentChapters[0].number === 2, 'recentCount=1 只带最新一章');
  await assertThrows('CHAPTER_NUMBER_CONFLICT', () => getGenerationContext(book.id, { chapterNumber: 2 }), '目标章已存在 → CHAPTER_NUMBER_CONFLICT');
  await assertThrows('BOOK_NOT_FOUND', () => getGenerationContext('book_nope'), '书不存在 → BOOK_NOT_FOUND');
}

// done 故事线过滤 + 提示词分节
{
  const arc = createArc(book.id, { title: '第一卷·寻火', summary: '寻找失落火种', startChapter: 3 });
  const arcDone = createArc(book.id, { title: '序卷·熄灭', status: 'done' });
  void arcDone;
  const ctx = getGenerationContext(book.id);
  assertOk(ctx.arcs.length === 1 && ctx.arcs[0].title === '第一卷·寻火', 'done 故事线不进上下文');

  updateArc(book.id, arc.id, { status: 'active' });
  const prompt = renderGenerationPrompt(getGenerationContext(book.id));
  for (const section of ['# 任务', '# 世界观与写作规则', '# 人物', '# 人物关系', '# 故事线', '# 未回收伏笔', '# 最近章节', '# 第 3 章大纲']) {
    assertOk(prompt.includes(section), `提示词含分节:${section.slice(2)}`);
  }
  assertOk(prompt.includes('必须覆盖全部要点') && prompt.includes('进入灰烬集市'), '有大纲时强制覆盖要点并含 beats');
  assertOk(!prompt.includes('灰烬的低语'), '提示词不含已回收伏笔');

  const again = renderGenerationPrompt(getGenerationContext(book.id));
  assertOk(again === prompt, '同上下文渲染结果逐字节确定');
}

console.log(failed === 0 ? '\n生成上下文组装器全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
