/**
 * V3 发布核心服务层验证:审核工作流(送审/批准/驳回)、待审核队列、
 * 自动发布配置校验、到期定时发布 publishDueChapters、每日自动发布 runAutopilot。
 *
 * 运行:npm run test:publish
 * 数据库使用临时目录(NOVEL_DATA_DIR),不触碰 data/novel.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-publish-'));

const {
  CoreError,
  createBook,
  createChapter,
  updateChapter,
  getChapterByNumber,
  listChapters,
  listAllBooks,
  submitChapterForReview,
  approveChapter,
  rejectChapter,
  listPendingReview,
  getAutopilotConfig,
  configureAutopilot,
  publishDueChapters,
  runAutopilot,
  runPublishCycle,
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

function expectCoreError(code: string, fn: () => unknown, name: string): void {
  try {
    fn();
    console.error(`✗ ${name}(未抛错)`);
    failed++;
  } catch (err) {
    if (err instanceof CoreError && err.code === code) {
      console.log(`✓ ${name}`);
    } else {
      console.error(`✗ ${name}(抛出 ${(err as Error).message})`);
      failed++;
    }
  }
}

// ---------- 准备:一本书 + 各状态章节 ----------
const book = createBook({ slug: 'review-flow', title: '审核流之书', authorName: '星尘', categoryName: '科幻' });
const bid = book.id;
for (let i = 1; i <= 6; i++) {
  createChapter({ bookId: bid, title: `第${i}章`, contentMd: `正文 ${i}` });
}

// ---------- 送审 ----------
{
  const ch = submitChapterForReview(bid, 1);
  assertOk(ch.status === 'pending_review', '送审:draft → pending_review');
  expectCoreError('INVALID_REVIEW_TRANSITION', () => submitChapterForReview(bid, 1), '重复送审拒绝');
  expectCoreError('INVALID_REVIEW_TRANSITION', () => approveChapter(bid, 4, { mode: 'now' }), '未送审 draft 直接批准拒绝');
  const published = updateChapter(bid, 3, { status: 'published' });
  expectCoreError('INVALID_REVIEW_TRANSITION', () => submitChapterForReview(bid, 3), '已发布章节不可送审');

  const ch2 = submitChapterForReview(bid, 2);
  assertOk(ch2.status === 'pending_review', '第二章送审成功');
}

// ---------- 队列 ----------
{
  const queue = listPendingReview();
  assertOk(queue.length === 2, `待审核队列含 2 项(${queue.length})`);
  assertOk(
    queue[0]!.chapter.number === 1 && queue[0]!.bookTitle === '审核流之书' && queue[0]!.bookSlug === 'review-flow',
    '队列按提交先后排序且带书籍摘要'
  );
  const withCount = listAllBooks({ limit: 10 }).find((b) => b.id === bid)!;
  assertOk(withCount.pendingReviewCount === 2, `BookWithMeta.pendingReviewCount = 2(${withCount.pendingReviewCount})`);
}

// ---------- 批准:立即 / 定时 ----------
{
  const now = approveChapter(bid, 1, { mode: 'now' });
  assertOk(now.status === 'published' && now.publishedAt !== null, '批准-立即:→ published 且记录发布时间');
  const future = new Date(Date.now() + 3600_000).toISOString();
  const sched = approveChapter(bid, 2, { mode: 'scheduled', scheduledAt: future });
  assertOk(sched.status === 'scheduled' && sched.scheduledAt === future, '批准-定时:→ scheduled 且写入时刻');
  expectCoreError('INVALID_REVIEW_TRANSITION', () => rejectChapter(bid, 1), '已批准章节不可驳回');
  expectCoreError('INVALID_REVIEW_TRANSITION', () => approveChapter(bid, 4, { mode: 'now' }), '未送审章节不可批准');
}

// ---------- 驳回 ----------
{
  submitChapterForReview(bid, 5);
  const back = rejectChapter(bid, 5, '第 5 章节奏拖沓,请压缩到三千字以内');
  assertOk(back.status === 'draft' && back.reviewNote === '第 5 章节奏拖沓,请压缩到三千字以内', '驳回:回 draft 并留备注');
  assertOk(listPendingReview().length === 0, '队列清空');
  // 再送审清空旧备注
  submitChapterForReview(bid, 5);
  const again = getChapterByNumber(bid, 5)!;
  assertOk(again.reviewNote === null, '再次送审清空旧备注');
  rejectChapter(bid, 5);
}

// ---------- 自动发布配置 ----------
{
  const def = getAutopilotConfig(bid);
  assertOk(!def.enabled && def.hour === 8 && def.count === 1 && def.lastRunDate === null, '默认配置:关/8点/1章/未运行');
  const cfg = configureAutopilot(bid, { enabled: true, hour: 8, count: 2 });
  assertOk(cfg.enabled && cfg.hour === 8 && cfg.count === 2, '配置更新生效');
  expectCoreError('INVALID_AUTOPILOT', () => configureAutopilot(bid, { hour: 24 }), 'hour=24 拒绝');
  expectCoreError('INVALID_AUTOPILOT', () => configureAutopilot(bid, { count: 0 }), 'count=0 拒绝');
  expectCoreError('BOOK_NOT_FOUND', () => configureAutopilot('book_missing', { enabled: true }), '未知书配置拒绝');
}

// ---------- 到期定时发布 ----------
{
  // 第 2 章已在未来一小时;把它改到过去 → 到期
  const past = new Date(Date.now() - 60_000).toISOString();
  updateChapter(bid, 2, { status: 'scheduled', scheduledAt: past });
  const n = publishDueChapters();
  assertOk(n === 1, `publishDueChapters 发布 1 章(${n})`);
  const ch2 = getChapterByNumber(bid, 2)!;
  assertOk(ch2.status === 'published' && ch2.publishedAt !== null, '到期章节转 published');
  assertOk(publishDueChapters() === 0, '无重复发布(幂等)');
}

// ---------- 每日自动发布 ----------
{
  // 配置:每天 0 点后自动发 1 章;当前时刻必然 >= 0 点
  configureAutopilot(bid, { enabled: true, hour: 0, count: 1 });
  const r1 = runAutopilot();
  assertOk(r1.books === 1 && r1.published === 1, `首次触发发布 1 章(${JSON.stringify(r1)})`);
  const oldest = getChapterByNumber(bid, 4)!; // 4、5 中最旧的 draft 是 4(5 已驳回为 draft 但编号更大? 顺序 number ASC)
  assertOk(oldest.status === 'published', '从最旧 draft(第4章)开始发布');
  assertOk(runAutopilot().published === 0, '同一天二次扫描不重复触发(lastRunDate 守卫)');

  // 昨天的 lastRunDate + 当前小时不足配置小时 → 不触发
  configureAutopilot(bid, { enabled: true, hour: 23 });
  assertOk(getAutopilotConfig(bid).lastRunDate !== null, '触发后记录 lastRunDate');
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  const r2 = runAutopilot(tomorrow);
  assertOk(r2.published === 0, '次日但未到配置小时不触发');
}

// ---------- runPublishCycle 汇总 ----------
{
  const past = new Date(Date.now() - 30_000);
  updateChapter(bid, 6, { status: 'scheduled', scheduledAt: past.toISOString() });
  configureAutopilot(bid, { hour: 0 });
  // 用"明天"的时刻跨过 lastRunDate 守卫(今天已在前面触发过)
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  const result = runPublishCycle(tomorrow);
  assertOk(result.duePublished === 1, `周期:到期定时发布 1 章(${result.duePublished})`);
  assertOk(result.autopilotPublished === 1, `周期:自动发布下一批 draft 1 章(${result.autopilotPublished})`);
  const statuses = listChapters(bid).map((c) => c.status);
  assertOk(statuses.every((s) => s === 'published'), `全部 6 章均已发布(${statuses.join(',')})`);
}

console.log(failed === 0 ? '\n发布工作流全部验证通过' : `\n${failed} 项发布工作流验证失败`);
process.exit(failed === 0 ? 0 : 1);
