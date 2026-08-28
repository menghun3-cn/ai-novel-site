/**
 * V9.5 阶段二补丁:短篇定时创作
 *   - scheduleShortStory 仅 draft/scheduled/failed 可设;切状态 + 写 scheduled_at
 *   - cancelShortStorySchedule 仅 scheduled 可取消;回退到 draft 并清空
 *   - listDueScheduledShortStories 正确返回到期项
 *   - fireScheduledStory scheduled → generating(清空 scheduled_at),同一 id 二次触发抛错
 *   - 调度器 runScheduleCycle 集成:到点 → 入队 CREATE_NOVEL
 *   - pipeline 通过后自动入队 PUBLISH_SHORT_STORY(passed 自动发布)
 */
process.env.AI_MODEL = 'mock-model';

import { CoreError, type LlmProvider } from '@novel/core';
import {
  cancelBatchSchedule,
  cancelShortStorySchedule,
  createBatchSchedule,
  createShortStory,
  createFakeProvider,
  deleteBatchSchedule,
  enqueueCreationPipeline,
  enqueuePublishShortStory,
  fireBatchSchedule,
  fireScheduledStory,
  getActiveRuleVersion,
  getBatchSchedule,
  getShortStory,
  latestPublicationByStory,
  listAiTasks,
  listBatchSchedules,
  listDueBatchSchedules,
  listDueScheduledShortStories,
  processAiTasks,
  publishShortStory,
  runCreationPipeline,
  scheduleShortStory,
  ensureDefaultReviewRule,
} from '@novel/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-schedule-'));

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
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

const DIM_NAMES = ['故事完整性', '情节与冲突', '人物塑造', '逻辑合理性', '情绪感染力', '语言表达', '创意与独特性'];

function reviewJson(score: number): string {
  return JSON.stringify({
    dimensions: DIM_NAMES.map((name) => ({ name, score, reason: '基于章节文本证据的具体评分理由,不少于三十字。' })),
    strengths: ['衔接自然'],
    weaknesses: ['节奏稍缓'],
    suggestions: ['加强张力'],
    summary: '总评。',
  });
}

function longContent(prefix: string): string {
  return `# ${prefix}\n\n` + '这是测试正文段落,用于满足质检的最低字数要求。'.repeat(60);
}

/** 多态 fake provider:按 prompt 标记区分返回(创建/优化/评审)
 *  - 包含 `# 评审要求` 或 `# 待评审小说` → 评审,返回 reviewJson(score)
 *  - 包含 `# 本次评审发现的问题` → 优化,返回 longContent('优化稿')
 *  - 包含 `请根据以下创作要求` → 创建,返回 longContent('初稿')
 */
function makeMultiProvider(score: number): LlmProvider {
  return createFakeProvider((prompt: string) => {
    const tag = prompt.includes('请根据以下创作要求') || prompt.includes('创作要求')
      ? 'CREATE'
      : prompt.includes('# 本次评审发现的问题')
        ? 'OPTIMIZE'
        : 'REVIEW';
    if (tag === 'CREATE') return longContent('初稿');
    if (tag === 'OPTIMIZE') return longContent('优化稿');
    return reviewJson(score);
  });
}

async function main(): Promise<void> {
  ensureDefaultReviewRule();
  if (!getActiveRuleVersion()) {
    console.error('未找到已发布规则,前置环境失败');
    process.exit(2);
  }

  // ---------- 1. 设定 / 取消 ----------
  const s1 = createShortStory({ title: '定时测试 1' });
  // 未设定时前 status=draft, scheduled_at=null
  assertOk(getShortStory(s1.id).status === 'draft', '新建默认状态=draft');
  assertOk(getShortStory(s1.id).scheduledAt === null, '新建 scheduled_at=null');

  // 非法时间
  await assertThrows('INVALID_INPUT', () => scheduleShortStory(s1.id, 'not-a-date'), '非法时间抛 INVALID_INPUT');

  // 设定 1 小时后
  const future = new Date(Date.now() + 3600_000).toISOString();
  scheduleShortStory(s1.id, future);
  assertOk(getShortStory(s1.id).status === 'scheduled', '设定后状态=scheduled');
  assertOk(getShortStory(s1.id).scheduledAt === future, 'scheduled_at 与设定一致');

  // 已 scheduled 状态可再次调整
  const future2 = new Date(Date.now() + 7200_000).toISOString();
  scheduleShortStory(s1.id, future2);
  assertOk(getShortStory(s1.id).scheduledAt === future2, '已 scheduled 状态可再次调整定时');

  // 取消
  cancelShortStorySchedule(s1.id);
  assertOk(getShortStory(s1.id).status === 'draft', '取消后回退到 draft');
  assertOk(getShortStory(s1.id).scheduledAt === null, '取消后 scheduled_at=null');

  // 取消已非 scheduled 的 → 抛错
  await assertThrows('INVALID_INPUT', () => cancelShortStorySchedule(s1.id), 'draft 状态不能取消定时');

  // passed 状态不允许设定时
  const s1b = createShortStory({ title: '定时测试 1b' });
  await runCreationPipeline(s1b.id, {
    provider: makeMultiProvider(90),
  });
  // pipeline 通过后 status=passed
  assertOk(getShortStory(s1b.id).status === 'passed', 'pipeline 一次过 → passed');
  await assertThrows('INVALID_INPUT', () => scheduleShortStory(s1b.id, future), 'passed 状态不允许设定时');

  // ---------- 2. 调度器扫描 ----------
  const s2 = createShortStory({ title: '定时测试 2' });
  const past = new Date(Date.now() - 60_000).toISOString();
  scheduleShortStory(s2.id, past);
  // 拉一个未来时间的,确认不会被 due 列表返回
  const s3 = createShortStory({ title: '定时测试 3' });
  scheduleShortStory(s3.id, future);

  const due = listDueScheduledShortStories();
  const dueIds = due.map((d) => d.id);
  assertOk(dueIds.includes(s2.id), '到期短篇出现在 due 列表');
  assertOk(!dueIds.includes(s3.id), '未到期短篇不在 due 列表');
  assertOk(!dueIds.includes(s1b.id), 'passed 不在 due 列表');

  // ---------- 3. fireScheduledStory ----------
  const before = getShortStory(s2.id);
  assertOk(before.status === 'scheduled' && before.scheduledAt !== null, 'fire 前 status=scheduled');
  fireScheduledStory(s2.id);
  const after = getShortStory(s2.id);
  assertOk(after.status === 'generating' && after.scheduledAt === null, 'fire 后 status=generating,scheduled_at=null');
  // 二次 fire 抛错(已不是 scheduled)
  await assertThrows('INVALID_INPUT', () => fireScheduledStory(s2.id), '已转 generating 后再 fire 抛 INVALID_INPUT');

  // ---------- 4. pipeline 集成:到点后 processAiTasks 完成 + 自动发布 ----------
  // 模拟调度器 tick:到点 → 入队(此时仍为 scheduled,守卫通过)→ fire 触发器置为 generating
  // 顺序不能反过来:enqueueCreationPipeline 不接受 generating
  const s4 = createShortStory({ title: '定时测试 4' });
  const almostPast = new Date(Date.now() - 5_000).toISOString();
  scheduleShortStory(s4.id, almostPast);
  const s4CreateTask = enqueueCreationPipeline(s4.id);
  fireScheduledStory(s4.id);
  // 用 fake provider 让生成通过质检、评审一次过
  const provider = makeMultiProvider(92);
  const results = await processAiTasks({ provider, limit: 10 });
  const createTask = results.find((r) => r.type === 'CREATE_NOVEL' && r.taskId === s4CreateTask.id);
  const publishTask = results.find((r) => r.type === 'PUBLISH_SHORT_STORY' && r.taskId?.startsWith('aitask_'));
  if (!createTask?.ok) {
    const r = results.find((r) => r.type === 'CREATE_NOVEL');
    console.error('  CREATE_NOVEL result:', r);
  }
  assertOk(!!createTask && createTask.ok, 'CREATE_NOVEL 任务成功');
  assertOk(!!publishTask && publishTask.ok, 'PUBLISH_SHORT_STORY 任务自动入队并成功');
  // 验证 s4 的 publish 任务留痕
  const pubs = listAiTasks({ refType: 'short_story', refId: s4.id, limit: 50 }).filter((t) => t.type === 'PUBLISH_SHORT_STORY');
  assertOk(pubs.length === 1, `s4 的 PUBLISH 任务留痕 1 条,实际 ${pubs.length}`);

  // ---------- 5. 手动 publish API 路径 ----------
  // 验证 enqueuePublishShortStory 也直接可用
  const s5 = createShortStory({ title: '定时测试 5' });
  await runCreationPipeline(s5.id, {
    provider: makeMultiProvider(95),
  });
  // 已通过 + 已自动发过 → 再入队手动任务应被 publishShortStory 守卫(already published at same version)拒绝
  const dupTask = enqueuePublishShortStory(s5.id);
  const dupResults = await processAiTasks({ provider, limit: 10 });
  const dupResult = dupResults.find((r) => r.taskId === dupTask.id);
  assertOk(!!dupResult && !dupResult.ok, '同 version 重复发布应失败(任务 FAILED)');
  // 但直接调用 publishShortStory 也应被短路(已 published)
  let threwAlready = false;
  try {
    publishShortStory(s5.id);
  } catch (err) {
    threwAlready = err instanceof CoreError && err.code === 'SHORT_STORY_NOT_PUBLISHED';
  }
  assertOk(threwAlready, 'publishShortStory(s5) 同 version 重复发布抛 SHORT_STORY_NOT_PUBLISHED');

  // ---------- 6. 自动标题:用户未填名称 → 采用 LLM 首行标题 ----------
  const auto1 = createShortStory({});
  assertOk(getShortStory(auto1.id).title === '未命名短篇', '未填标题时占位=未命名短篇');
  await runCreationPipeline(auto1.id, { provider: makeMultiProvider(91) });
  assertOk(getShortStory(auto1.id).title === '初稿', '未填标题时自动采用 LLM 首行标题');
  assertOk(getShortStory(auto1.id).status === 'passed', '自动标题流程通过 → passed');

  const auto2 = createShortStory({ title: '用户指定标题' });
  await runCreationPipeline(auto2.id, { provider: makeMultiProvider(90) });
  assertOk(getShortStory(auto2.id).title === '用户指定标题', '用户已填标题时保留,不覆盖');

  // ---------- 7. 批量定时创作(V9.6) ----------
  // 7.1 创建与参数校验
  const b1 = createBatchSchedule({ scheduledAt: past, count: 3, brief: { theme: '批量主题', synopsis: '批量梗概' } });
  assertOk(getBatchSchedule(b1.id).status === 'pending', '新建批量定时=pending');
  assertOk(getBatchSchedule(b1.id).count === 3, '批量定时 count=3');
  assertOk(getBatchSchedule(b1.id).brief.theme === '批量主题', '批量定时共享 brief 落库');
  await assertThrows('INVALID_INPUT', () => createBatchSchedule({ scheduledAt: 'not-a-date', count: 3 }), '非法时间抛 INVALID_INPUT');
  await assertThrows('INVALID_INPUT', () => createBatchSchedule({ scheduledAt: future, count: 0 }), 'count=0 抛 INVALID_INPUT');
  await assertThrows('INVALID_INPUT', () => createBatchSchedule({ scheduledAt: future, count: 51 }), 'count=51 抛 INVALID_INPUT');

  // 7.2 到期扫描
  const b2 = createBatchSchedule({ scheduledAt: future, count: 2 });
  const dueBatch = listDueBatchSchedules();
  assertOk(dueBatch.some((b) => b.id === b1.id), '到期批量定时出现在 due 列表');
  assertOk(!dueBatch.some((b) => b.id === b2.id), '未到期批量定时不在 due 列表');

  // 7.3 到点触发:创建 count 篇 + 逐篇入队
  const fired = fireBatchSchedule(b1.id);
  assertOk(fired.createdStoryIds.length === 3, 'fire 一次性创建 3 篇短篇');
  const b1After = getBatchSchedule(b1.id);
  assertOk(b1After.status === 'done' && b1After.executedAt !== null, 'fire 后状态=done 且 executed_at 非空');
  assertOk(b1After.storyIds.length === 3, 'story_ids 落库 3 条');
  for (const sid of fired.createdStoryIds) {
    const s = getShortStory(sid);
    assertOk(s.status === 'draft', `批量短篇 ${sid} 初始为 draft`);
    assertOk(s.brief.theme === '批量主题', `批量短篇 ${sid} 继承共享 brief`);
  }
  await assertThrows('INVALID_INPUT', () => fireBatchSchedule(b1.id), '已 done 再 fire 抛 INVALID_INPUT');

  // 7.4 流水线闭环:全部通过评审 + 自动发布
  const batchCreateTasks = listAiTasks({ refType: 'short_story', limit: 100 }).filter(
    (t) => t.type === 'CREATE_NOVEL' && fired.createdStoryIds.includes(t.refId ?? '')
  );
  assertOk(batchCreateTasks.length === 3, `批量入队 3 个 CREATE_NOVEL 任务,实际 ${batchCreateTasks.length}`);
  const resultsBatch1 = await processAiTasks({ provider: makeMultiProvider(93), limit: 10 });
  const createAllOk = fired.createdStoryIds.every((sid) => {
    const task = batchCreateTasks.find((t) => t.refId === sid);
    const r = task ? resultsBatch1.find((x) => x.taskId === task.id) : undefined;
    return !!r && r.ok;
  });
  assertOk(createAllOk, '批量 3 篇 CREATE_NOVEL 全部成功(passed)');
  for (const sid of fired.createdStoryIds) {
    assertOk(getShortStory(sid).status === 'passed', `批量短篇 ${sid} 通过评审 → passed`);
  }
  // 通过评审后自动发布(PUBLISH 任务由流水线入队,下一轮 processAiTasks 执行)
  await processAiTasks({ provider: makeMultiProvider(93), limit: 10 });
  for (const sid of fired.createdStoryIds) {
    assertOk(latestPublicationByStory(sid) !== null, `批量短篇 ${sid} 通过评审后自动发布`);
  }

  // 7.5 取消与删除
  await assertThrows('INVALID_INPUT', () => cancelBatchSchedule(b1.id), '已 done 不能取消');
  cancelBatchSchedule(b2.id);
  assertOk(getBatchSchedule(b2.id).status === 'cancelled', '取消后状态=cancelled');
  assertOk(!listDueBatchSchedules().some((b) => b.id === b2.id), '已取消不出现在 due 列表');
  deleteBatchSchedule(b2.id);
  let batchDeleted = false;
  try {
    getBatchSchedule(b2.id);
  } catch (err) {
    batchDeleted = err instanceof CoreError && err.code === 'BATCH_SCHEDULE_NOT_FOUND';
  }
  assertOk(batchDeleted, '删除后 getBatchSchedule 抛 BATCH_SCHEDULE_NOT_FOUND');
  assertOk(listBatchSchedules().some((b) => b.id === b1.id), 'done 计划在列表可见');

  // ---------- 9. 批量定时每日重复(V9.7) ----------
  const pad9 = (n: number): string => String(n).padStart(2, '0');
  const localDateOf = (d: Date): string => `${d.getFullYear()}-${pad9(d.getMonth() + 1)}-${pad9(d.getDate())}`;
  const today9 = localDateOf(new Date());
  const tomorrow9 = new Date(Date.now() + 24 * 3600_000);
  const dayAfter9 = new Date(Date.now() + 48 * 3600_000);
  const dailyPast = new Date(Date.now() - 5 * 60_000).toISOString();

  const d1 = createBatchSchedule({ scheduledAt: dailyPast, count: 2, brief: { theme: '每日主题' }, repeatDaily: true });
  assertOk(getBatchSchedule(d1.id).repeatDaily === true, '每日计划 repeatDaily=true');
  assertOk(getBatchSchedule(d1.id).status === 'pending', '每日计划初始 pending');
  assertOk(listDueBatchSchedules().some((b) => b.id === d1.id), '每日计划今天时刻已到 → 出现在 due 列表');

  const firedD1 = fireBatchSchedule(d1.id);
  assertOk(firedD1.createdStoryIds.length === 2, '每日计划首次触发创建 2 篇');
  const d1After = getBatchSchedule(d1.id);
  assertOk(d1After.status === 'pending', '每日计划触发后保持 pending(等待次日)');
  assertOk(d1After.lastFiredDate === today9, `last_fired_date=今天(${today9})`);
  assertOk(d1After.executedAt === null, '每日计划不写 executed_at');
  assertOk(d1After.storyIds.length === 2, 'story_ids 记录 2 条');

  // 同日去重:due 列表不再返回;直接 fire 也被守卫拦截
  assertOk(!listDueBatchSchedules().some((b) => b.id === d1.id), '同日不再出现在 due 列表(去重)');
  await assertThrows('INVALID_INPUT', () => fireBatchSchedule(d1.id), '同日再次 fire 抛 INVALID_INPUT');

  // 跨日:明天可再次触发,story_ids 跨日累积
  const firedD2 = fireBatchSchedule(d1.id, { now: tomorrow9 });
  assertOk(firedD2.createdStoryIds.length === 2, '次日再次触发创建 2 篇');
  assertOk(getBatchSchedule(d1.id).lastFiredDate === localDateOf(tomorrow9), '次日触发后 last_fired_date=明天');
  assertOk(getBatchSchedule(d1.id).storyIds.length === 4, 'story_ids 跨日累积为 4 条');
  assertOk(!listDueBatchSchedules(tomorrow9).some((b) => b.id === d1.id), '明天(已触发)不再出现在 due 列表');
  assertOk(listDueBatchSchedules(dayAfter9).some((b) => b.id === d1.id), '后天重新出现在 due 列表');

  // 取消每日计划后不再触发
  cancelBatchSchedule(d1.id);
  assertOk(getBatchSchedule(d1.id).status === 'cancelled', '每日计划可取消(停止重复)');
  assertOk(!listDueBatchSchedules(dayAfter9).some((b) => b.id === d1.id), '取消后不再出现在 due 列表');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
