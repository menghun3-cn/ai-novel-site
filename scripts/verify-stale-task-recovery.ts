/**
 * V10.6 僵尸 RUNNING 任务恢复:调度器 tick 中 recoverStaleRunningTasks 的单元测试
 * - 老的 RUNNING 任务(started_at 早于阈值)→ 被重置为 PENDING,执行痕迹清空,attempt 保留
 * - 新近的 RUNNING 任务(阈值内)→ 不受影响(防误伤执行中的任务)
 * - PENDING / SUCCESS 任务 → 不受影响
 * - 恢复后的任务可被 claimPendingTasks 重新认领
 * - processAiTasks 能重新执行被恢复的任务并正常完成(端到端闭环)
 *
 * 运行:npm run test:stale-task-recovery
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-stale-recovery-'));
process.env.AI_MODEL = 'mock-model';

const {
  upsertAuthor,
  upsertCategory,
  createBook,
  createChapter,
  ensureDefaultReviewRule,
  getActiveRuleVersion,
  createFakeProvider,
  enqueueChapterReview,
  processAiTasks,
  recoverStaleRunningTasks,
  claimPendingTasks,
  getDb,
} = await import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

const DIM_NAMES = ['故事完整性', '情节与冲突', '人物塑造', '逻辑合理性', '情绪感染力', '语言表达', '创意与独特性'];
function reviewJson(score: number): string {
  return JSON.stringify({
    dimensions: DIM_NAMES.map((n) => ({ name: n, score, reason: '基于章节文本证据的具体评分理由,不少于三十字。' })),
    strengths: ['结构完整'],
    weaknesses: ['节奏'],
    suggestions: ['加强张力'],
    summary: '总评。',
  });
}

function setRunning(taskId: string, startedAt: string, attempt = 1): void {
  getDb()
    .prepare(
      `UPDATE ai_tasks SET status = 'RUNNING', started_at = ?, finished_at = NULL,
         duration_ms = NULL, error = NULL, attempt = ?
       WHERE id = ?`
    )
    .run(startedAt, attempt, taskId);
}

function taskRow(taskId: string): Record<string, unknown> {
  return getDb().prepare('SELECT * FROM ai_tasks WHERE id = ?').get(taskId) as Record<string, unknown>;
}

async function main(): Promise<void> {
  ensureDefaultReviewRule();
  if (!getActiveRuleVersion()) {
    console.error('未找到已发布规则,前置环境失败');
    process.exit(2);
  }

  upsertAuthor('测试作者');
  upsertCategory('测试分类');
  const book = createBook({
    slug: 'book-stale-test',
    title: '僵尸恢复测试书',
    authorName: '测试作者',
    categoryName: '测试分类',
    tags: [],
  });
  const chapter = createChapter({
    bookId: book.id,
    number: 1,
    title: '第一章',
    contentMd: '僵尸恢复测试章节正文。'.repeat(20),
    status: 'published',
  });

  const oldTs = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 分钟前
  const freshTs = new Date().toISOString(); // 刚刚

  // 1) 老 RUNNING(2 分钟前开始)→ 应被恢复
  const stale = enqueueChapterReview(chapter.id);
  setRunning(stale.id, oldTs, 2);

  // 2) 新 RUNNING(刚刚开始)→ 不应被恢复
  const fresh = enqueueChapterReview(chapter.id);
  setRunning(fresh.id, freshTs, 1);

  // 3) 正常 PENDING → 不受影响
  const pending = enqueueChapterReview(chapter.id);

  // 阈值 60 秒:老任务超出,新任务未超出
  const recovered = recoverStaleRunningTasks(60 * 1000);
  assertOk(recovered.length === 1, `仅恢复 1 个僵尸任务(实际 ${recovered.length})`);
  assertOk(recovered[0]?.id === stale.id, '恢复的是老 RUNNING 任务');

  const staleAfter = taskRow(stale.id);
  assertOk(staleAfter.status === 'PENDING', '老任务被重置为 PENDING');
  assertOk(staleAfter.started_at === null, 'started_at 已清空');
  assertOk(staleAfter.finished_at === null, 'finished_at 已清空');
  assertOk(staleAfter.duration_ms === null, 'duration_ms 已清空');
  assertOk(staleAfter.attempt === 2, 'attempt 历史次数保留');
  assertOk(staleAfter.error === null, 'error 已清空');

  const freshAfter = taskRow(fresh.id);
  assertOk(freshAfter.status === 'RUNNING', '新近 RUNNING 任务不受影响');

  const pendingAfter = taskRow(pending.id);
  assertOk(pendingAfter.status === 'PENDING', 'PENDING 任务不受影响');

  // 4) 恢复后的任务可被重新认领
  const claimed = claimPendingTasks(10);
  assertOk(claimed.some((t) => t.id === stale.id), '恢复后的任务可被 claimPendingTasks 认领');

  // 5) processAiTasks 重新执行被恢复的任务 → 正常完成(端到端)
  const provider = createFakeProvider((_p: string) => reviewJson(90));
  const results = await processAiTasks({ limit: 10, provider });
  const ours = results.find((r) => r.taskId === stale.id);
  assertOk(ours !== undefined, '被恢复的任务被重新执行');
  assertOk(ours?.ok === true, `重新执行成功(error=${ours?.error ?? ''})`);
  assertOk(taskRow(stale.id).status === 'SUCCESS', '重新执行后任务 SUCCESS');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
