/**
 * V8 数据分析验证:阅读会话记录 + 总览聚合 + 单书漏斗 + 流失标记。
 * 运行:npm run test:analytics
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-analytics-'));

const core = await import('@novel/core');
const { getDb } = core;

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!failed) failed += cond ? 0 : 1;
  else if (!cond) failed++;
}
async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (e) {
    assertOk(e instanceof core.CoreError && e.code === code, name);
  }
}

// ---------- 种子:2 本书,不同章节数与 PV/完读量 ----------
const book1 = core.createBook({ slug: 'an-book1', title: '数据分析测试书1', authorName: '测', categoryName: '科幻', tags: [] });
const book2 = core.createBook({ slug: 'an-book2', title: '数据分析测试书2', authorName: '测', categoryName: '都市', tags: [] });

// book1:5 章,模拟漏斗:第1章高 PV 逐章递减,第4章明显流失
for (let i = 1; i <= 5; i++) {
  core.createChapter({ bookId: book1.id, number: i, title: `第${i}章`, contentMd: `# 第${i}章\n\n` + '内容'.repeat(500) });
  core.submitChapterForReview(book1.id, i);
  core.approveChapter(book1.id, i, { mode: 'now' });
}
// 手动填 PV:Ch1=100,Ch2=90,Ch3=85,Ch4=50←流失,Ch5=45
const db = getDb();
const pvs = [100, 90, 85, 50, 45];
const finishes = [70, 65, 55, 15, 20]; // Ch4 完读也很低
for (let i = 0; i < 5; i++) {
  db.prepare('UPDATE chapters SET view_count = ?, finish_count = ? WHERE book_id = ? AND number = ?').run(pvs[i], finishes[i], book1.id, i + 1);
  db.prepare('UPDATE books SET view_count = view_count + ? WHERE id = ?').run(pvs[i], book1.id);
}

// book2:3 章,均匀分布无流失
for (let i = 1; i <= 3; i++) {
  core.createChapter({ bookId: book2.id, number: i, title: `第${i}章`, contentMd: `# 第${i}章\n\n` + '内容'.repeat(500) });
  core.submitChapterForReview(book2.id, i);
  core.approveChapter(book2.id, i, { mode: 'now' });
}
db.prepare('UPDATE chapters SET view_count = ?, finish_count = ? WHERE book_id = ? AND number = ?').run(50, 40, book2.id, 1);
db.prepare('UPDATE chapters SET view_count = ?, finish_count = ? WHERE book_id = ? AND number = ?').run(48, 38, book2.id, 2);
db.prepare('UPDATE chapters SET view_count = ?, finish_count = ? WHERE book_id = ? AND number = ?').run(46, 36, book2.id, 3);

// ---------- 阅读会话 ----------
{
  const sid1 = core.startReadingSession(book1.id, 1);
  await new Promise((r) => setTimeout(r, 100)); // 模拟 0.1s 阅读
  core.finishReadingSession(sid1);
  // 重复调用 finish 应幂等
  core.finishReadingSession(sid1);

  // 未结束会话(不计入时长)
  core.startReadingSession(book1.id, 2);

  // 检查 session 存在
  const sessions = db.prepare('SELECT * FROM reading_sessions ORDER BY id').all() as Array<{ duration_sec: number | null }>;
  assertOk(sessions.length >= 2, `至少有 2 个会话(${sessions.length})`);
  const finished = sessions.filter((s) => s.duration_sec !== null);
  assertOk(finished.length >= 1, `至少 1 个已完成会话(${finished.length})`);
}

// ---------- 总览 ----------
{
  const ov = core.getAnalyticsOverview();
  assertOk(ov.totalBooks === 2, `总览:2 本书(${ov.totalBooks})`);
  // 章 PV = 100+90+85+50+45+50+48+46=514
  const expectedPv = pvs.reduce((a, b) => a + b, 0) + 50 + 48 + 46;
  assertOk(ov.totalPv === expectedPv, `总章 PV=${expectedPv}(${ov.totalPv})`);
  // 完读 = 70+65+55+15+20+40+38+36=339
  const expectedFinish = finishes.reduce((a, b) => a + b, 0) + 40 + 38 + 36;
  assertOk(ov.totalFinish === expectedFinish, `总完读=${expectedFinish}(${ov.totalFinish})`);

  // 整体完读率
  assertOk(ov.overallFinishRate > 0 && ov.overallFinishRate <= 1, `完读率在 (0,1]:${ov.overallFinishRate.toFixed(3)}`);
  assertOk(ov.totalPublishedChapters === 8, `已发布 8 章(${ov.totalPublishedChapters})`);
}

// ---------- 单书漏斗(book1:存在流失) ----------
{
  const funnel = core.getBookFunnel(book1.id);
  assertOk(funnel.bookTitle === '数据分析测试书1', `书名正确:${funnel.bookTitle}`);
  assertOk(funnel.chapters.length === 5, `5 章(${funnel.chapters.length})`);
  assertOk(funnel.baselinePv === 100, `基线 PV=100(${funnel.baselinePv})`);

  const ch1 = funnel.chapters[0];
  assertOk(ch1.retention === 100, `第1章留存率=100%(${ch1.retention})`);

  // 第4章:PV=50,较第3章(85)留存下降 50-85=-35 → 流失标记
  const ch4 = funnel.chapters[3];
  assertOk(ch4.flagged && ch4.flagReason === 'drop-off', `第4章标记流失(${ch4.flagReason})`);
  assertOk(ch4.retention === 50, `第4章留存率=50%(${ch4.retention})`);
  // 第4章完读率 15/50=30% 刚好边界,因 flags 逻辑(dropOff || lowFinish)而仍触发
  assertOk(ch4.finishRate === 30, `第4章完读率=30%(${ch4.finishRate})`);

  // 第3章:PV=85,完读率 55/85≈64.7%,不应标记
  const ch3 = funnel.chapters[2];
  assertOk(!ch3.flagged, `第3章无标记(flag=${ch3.flagged})`);
  assertOk(ch3.retention === 85, `第3章留存率=85%(${ch3.retention})`);
}

// ---------- 单书漏斗(book2:无流失) ----------
{
  const funnel = core.getBookFunnel(book2.id);
  assertOk(funnel.chapters.length === 3, `3 章(${funnel.chapters.length})`);
  // 所有章应无标记
  const flagged = funnel.chapters.filter((c) => c.flagged);
  assertOk(flagged.length === 0, `无流失标记(${flagged.length} 个)`);
  // 留存率递减非常平缓(第3章较第1章 46/50=92%)
  assertOk(funnel.chapters[2].retention >= 85, `末章留存≥85%(${funnel.chapters[2].retention}%)`);
}

// ---------- 边界:未知书 → BOOK_NOT_FOUND ----------
await assertThrows('BOOK_NOT_FOUND', () => core.getBookFunnel('book_nope'), '未知书漏斗 → BOOK_NOT_FOUND');

// ---------- getBookChapterMetrics 快捷方法 ----------
{
  const metrics = core.getBookChapterMetrics(book1.id);
  assertOk(metrics.length === 5 && metrics[0].chapterNumber === 1, `快捷方法返回 5 章(首章#${metrics[0].chapterNumber})`);
}

console.log(failed === 0 ? '\nV8 数据分析全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
