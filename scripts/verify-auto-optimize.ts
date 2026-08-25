/**
 * V9 创作流水线闭环验证:生成→评审→优化→再评审、达标即停、最大轮数后入池、
 * 版本链不可变、任务分发(processAiTasks)成功/失败路径、手动评审/手动优化独立计数。
 *
 * 运行:npm run test:auto-optimize
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-auto-optimize-'));

const {
  getActiveRuleVersion,
  createShortStory,
  getStoryDetail,
  getShortStory,
  listReviewRecords,
  listAiTasks,
  getAiTask,
  retryAiTask,
  createFakeProvider,
  enqueueCreationPipeline,
  enqueueManualReview,
  enqueueManualOptimize,
  processAiTasks,
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

const DIM_NAMES = ['故事完整性', '情节与冲突', '人物塑造', '逻辑合理性', '情绪感染力', '语言表达', '创意与独特性'];

function reviewJson(scores: number[]): string {
  return JSON.stringify({
    dimensions: DIM_NAMES.map((name, i) => ({ name, score: scores[i] ?? 50, reason: `第${i + 1}维理由,依据文本证据充分说明。` })),
    strengths: ['结构完整'],
    weaknesses: ['配角单薄'],
    suggestions: ['增强配角动机'],
    summary: '总评文字。',
  });
}

// 非周期性正文:段落序号保证任意 60 字窗口不重复(否则会被流水线基础质检拦截)
const NOVEL_TEXT = Array.from(
  { length: 80 },
  (_, i) => `第${i + 1}段:雨夜重逢的正文内容,情节推进与情绪层次各不相同。`
).join('');
const OPTIMIZED_MARKER = '(修订稿)';

interface Scripted {
  reviews: number[][];
}

/** 按提示词特征分派响应:创作请求→正文;评审请求→按队列出分;修订请求→带标记正文 */
function makePipelineProvider(script: Scripted) {
  let oi = 0;
  return createFakeProvider((prompt: string) => {
    if (prompt.includes('评分维度与标准')) {
      const scores = script.reviews[Math.min(oi, script.reviews.length - 1)];
      oi++;
      return reviewJson(scores);
    }
    if (prompt.includes('针对评审发现的问题修订')) {
      return NOVEL_TEXT.replace(/$/u, '') + `\n\n${OPTIMIZED_MARKER}`;
    }
    return NOVEL_TEXT;
  });
}

async function main(): Promise<void> {
  const rule = getActiveRuleVersion();
  assertOk(rule !== null && rule.maxAutoOptimizeRounds === 3 && rule.qualityThreshold === 80, '默认规则就绪(阈值80/3轮)');

  // ---------- 场景A:一次优化后达标,经任务系统跑通 ----------
  {
    const story = createShortStory({ title: '场景A', brief: { theme: '爱情', targetWords: 3000 } });
    const task = enqueueCreationPipeline(story.id);
    const results = await processAiTasks({ provider: makePipelineProvider({ reviews: [[70, 70, 70, 70, 70, 70, 70], [82, 82, 82, 82, 82, 82, 82]] }) });
    // 70 分未达标 → 优化一次 → 82 达标
    assertOk(results.length === 1 && results[0].ok, 'CREATE_NOVEL 任务执行成功');
    assertOk(getAiTask(task.id).status === 'SUCCESS', '任务终态 SUCCESS');
    const s = getShortStory(story.id);
    assertOk(s.status === 'passed', '小说终态 passed');
    const detail = getStoryDetail(s.id);
    assertOk(detail.versions.length === 2, 'V1 生成 + V2 优化');
    assertOk(
      detail.versions[0].creationReason === 'generated' && detail.versions[1].creationReason === 'ai_optimized',
      '版本产生原因链正确'
    );
    assertOk(detail.versions[1].isFinal && !detail.versions[0].isFinal, '达标版本为最终版');
    assertOk(detail.versions[1].content.includes(OPTIMIZED_MARKER), 'V2 为修订稿');
    assertOk(!detail.versions[0].content.includes(OPTIMIZED_MARKER), 'V1 原文未被覆盖');
    assertOk(s.reviewRound === 2 && s.optimizeRound === 1 && s.lastScore === 82, '轮次与最近评分正确');
    assertOk(listReviewRecords({ storyId: s.id }).length === 2, '两次评审记录齐全');
    const outcome = getAiTask(task.id).output as { status?: string; score?: number };
    assertOk(outcome?.status === 'passed' && outcome?.score === 82, '任务输出含结果摘要');
  }

  // ---------- 场景B:三轮不收敛 → 低质量池 ----------
  {
    const s2 = createShortStory({ title: '场景B' });
    enqueueCreationPipeline(s2.id);
    const results = await processAiTasks({
      limit: 10,
      provider: makePipelineProvider({
        reviews: [
          [60, 60, 60, 60, 60, 60, 60],
          [65, 65, 65, 65, 65, 65, 65],
          [62, 62, 62, 62, 62, 62, 62],
          [64, 64, 64, 64, 64, 64, 64],
        ],
      }),
    });
    assertOk(results.length === 1 && results[0].ok, '任务执行成功');
    const b = getShortStory(s2.id);
    assertOk(b.status === 'pool', `三轮不收敛进入低质量池(实际 ${b.status})`);
    assertOk(b.optimizeRound === 3 && b.reviewRound === 4, '恰好 3 次优化 / 4 次评审后停止');
    assertOk(b.lastScore === 64, '最近评分为最后一轮 64');
    const detail = getStoryDetail(b.id);
    assertOk(detail.versions.length === 4 && detail.versions.filter((v) => v.isFinal).length === 0, '入池作品无最终版标记');
  }

  // ---------- 场景C:生成质检不过 → 任务 FAILED + 小说 failed → 重试可复跑 ----------
  {
    const story = createShortStory({ title: '场景C' });
    const task = enqueueCreationPipeline(story.id);
    const results = await processAiTasks({
      provider: createFakeProvider(() => '太短'),
    });
    assertOk(results.length === 1 && !results[0].ok && (results[0].error ?? '').includes('质检'), '生成过短被质检拦截并记录原因');
    assertOk(getAiTask(task.id).status === 'FAILED', '任务 FAILED');
    assertOk(getShortStory(story.id).status === 'failed', '小说置为 failed(错误可见不静默)');
    // 重试任务并换成好 Provider → 成功
    retryAiTask(task.id);
    await processAiTasks({
      provider: makePipelineProvider({ reviews: [[90, 90, 90, 90, 90, 90, 90]] }),
    });
    assertOk(getShortStory(story.id).status === 'passed', '重试后流水线成功(90 分直达)');
  }

  // ---------- 场景D:手动评审 + 手动优化(独立计数) ----------
  {
    const story = createShortStory({ title: '场景D' });
    enqueueCreationPipeline(story.id);
    await processAiTasks({
      provider: makePipelineProvider({ reviews: [[85, 85, 85, 85, 85, 85, 85]] }),
    });
    const before = getShortStory(story.id);
    assertOk(before.status === 'passed' && before.optimizeRound === 0, '一次过场景无自动优化');

    // 手动优化:基于当前版本的最新评审记录
    enqueueManualOptimize(story.id);
    await processAiTasks({ provider: makePipelineProvider({ reviews: [] }) });
    const afterOpt = getShortStory(story.id);
    assertOk(afterOpt.manualOptimizeRound === 1 && afterOpt.optimizeRound === 0, '手动优化计入独立计数,不动自动计数');
    assertOk(getStoryDetail(story.id).versions.length === 2, '手动优化产生新版本');

    // 手动重新评审
    const mReview = enqueueManualReview(story.id);
    await processAiTasks({ provider: makePipelineProvider({ reviews: [[88, 88, 88, 88, 88, 88, 88]] }) });
    const afterReview = getShortStory(story.id);
    assertOk(afterReview.reviewRound === 2 && afterReview.lastScore === 88, '手动评审轮次与评分更新');
    assertOk(getAiTask(mReview.id).status === 'SUCCESS', '手动评审任务 SUCCESS');
  }

  // ---------- 场景E:无版本时手动评审报错并可重试 ----------
  {
    const story = createShortStory({ title: '场景E' });
    const t = enqueueManualReview(story.id);
    const results = await processAiTasks({ provider: createFakeProvider(() => 'x') });
    assertOk(!results[0].ok, '无版本评审失败');
    assertOk(getAiTask(t.id).error !== null && getAiTask(t.id).status === 'FAILED', '错误保留在任务上');
    retryAiTask(t.id);
    assertOk(getAiTask(t.id).status === 'PENDING', '重试后回到 PENDING(attempt 保留)');
  }

  assertOk(listAiTasks().length >= 6, '任务历史完整可查');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
