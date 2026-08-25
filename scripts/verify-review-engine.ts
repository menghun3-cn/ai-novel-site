/**
 * V9 自动评审引擎验证:加权总分服务端计算、等级/达标判定、评审记录全链路快照、
 * 坏输出重试、重试耗尽不落库、多轮评审轮次递增。
 *
 * 运行:npm run test:review-engine
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-review-engine-'));

const {
  CoreError,
  getActiveRuleVersion,
  createShortStory,
  appendVersion,
  runAutoReview,
  listReviewRecords,
  latestReviewForVersion,
  getShortStory,
  createFakeProvider,
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

/** 按给定分数序列构造模型评审 JSON */
function reviewJson(scores: number[]): string {
  const dims = DIM_NAMES.map((name, i) => ({
    name,
    score: scores[i] ?? 50,
    reason: `维度${i + 1}的打分理由,依据文本证据充分展开说明。`,
  }));
  return JSON.stringify({
    dimensions: dims,
    strengths: ['冲突建立自然'],
    weaknesses: ['配角较单薄'],
    suggestions: ['增强配角动机'],
    summary: '整体完整,中段节奏偏快。',
  });
}

async function main(): Promise<void> {
  // 生效规则(触发默认播种)
  const active = getActiveRuleVersion();
  assertOk(active !== null && active.dimensions.length === 7, '生效规则就绪');

  const story = createShortStory({ title: '雨夜重逢', sourceUrl: 'https://example.com/novel/1' });
  const v1 = appendVersion(story.id, { content: '雨夜的重逢故事正文。'.repeat(50), creationReason: 'generated' });

  // 正常评审:加权总分服务端计算
  // 88*20 + 76*20 + 64*15 + 52*15 + 90*10 + 82*10 + 70*10 = 7440 → 74
  {
    const p = createFakeProvider(() => reviewJson([88, 76, 64, 52, 90, 82, 70]));
    const rec = await runAutoReview(v1.id, { provider: p as never });
    assertOk(rec.score === 74, `加权总分 74(实际 ${rec.score})`);
    assertOk(rec.level === 'B' && rec.qualified === false, '74 分 → B 级未达标(阈值 80)');
    assertOk(
      rec.dimensionScores.find((d) => d.name === '故事完整性')?.maxScore === 20,
      '维度展示满分=权重'
    );
    assertOk(rec.ruleVersion === 'v1.0' && rec.promptVersion === 'v1.0', '记录快照规则/Prompt 版本');
    assertOk(rec.modelName === 'fake' && rec.durationMs !== null, '记录快照模型名与耗时');
    assertOk(rec.sourceUrl === 'https://example.com/novel/1', '记录快照小说源地址');
    assertOk((rec.rawResponse ?? '').includes('"score"'), '保存原始响应');
    assertOk(rec.reviewRound === 1 && rec.optimizationRound === 0, '第 1 次评审 / 第 0 次优化');
    assertOk(rec.strengths.length === 1 && rec.summary.length > 0, '优点与总评入库');
    const storyAfter = getShortStory(story.id);
    assertOk(storyAfter.reviewRound === 1 && storyAfter.lastScore === 74, '主档轮次与最近评分同步');
  }

  // 同版本再评:轮次递增
  {
    const rec2 = await runAutoReview(v1.id, { provider: createFakeProvider(() => reviewJson([95, 95, 95, 95, 95, 95, 95])) as never });
    // 95*100 权重和恰好 → 9500/100 = 95
    assertOk(rec2.score === 95 && rec2.level === 'S' && rec2.qualified === true, '全 95 → 95 分 S 级达标');
    assertOk(rec2.reviewRound === 2, '第二次评审轮次为 2');
    assertOk(latestReviewForVersion(v1.id)?.id === rec2.id, '最新评审指向第二次');
    assertOk(listReviewRecords({ storyId: story.id }).length === 2, '该小说共两条评审记录');
  }

  // 重试路径:第一次坏 JSON,第二次好
  {
    let n = 0;
    const p = createFakeProvider(() => {
      n++;
      return n === 1 ? '我觉得这篇小说不错。' : reviewJson([80, 80, 80, 80, 80, 80, 80]);
    });
    const rec = await runAutoReview(v1.id, { provider: p as never });
    assertOk(rec.score === 80 && n === 2, '坏输出自纠后成功落库');
  }

  // 重试耗尽:不落库,轮次不变
  {
    const beforeRound = getShortStory(story.id).reviewRound;
    try {
      await runAutoReview(v1.id, {
        provider: createFakeProvider(() => '{"dimensions": []}') as never,
      });
      assertOk(false, '缺维度应抛错(未抛)');
    } catch (err) {
      const ok = err instanceof CoreError && err.code === 'STRUCTURED_OUTPUT_FAILED';
      assertOk(ok, '重试耗尽抛 STRUCTURED_OUTPUT_FAILED');
    }
    assertOk(getShortStory(story.id).reviewRound === beforeRound, '失败评审不计入轮次');
    const total = listReviewRecords({ storyId: story.id }).length;
    assertOk(total === 3, `失败评审不产生记录(当前 ${total} 条)`);
  }

  // 指定规则版本的回放入口可用(同规则再评)
  {
    const rec = await runAutoReview(v1.id, { ruleVersion: active!, provider: createFakeProvider(() => reviewJson([70, 70, 70, 70, 70, 70, 70])) as never });
    assertOk(rec.score === 70 && rec.ruleVersion === active!.version, '显式传规则版本可回放评审');
  }
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
