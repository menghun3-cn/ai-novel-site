/**
 * V9 短篇小说服务层验证:创建/编辑、brief 白名单归一化、版本只增不改、
 * 最终版唯一、状态流转、删除守卫。
 *
 * 运行:npm run test:short-story
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-short-story-'));

const {
  CoreError,
  createShortStory,
  updateShortStory,
  getShortStory,
  tryGetShortStory,
  listShortStories,
  appendVersion,
  getStoryVersion,
  listStoryVersions,
  getStoryDetail,
  setFinalVersion,
  transitionStory,
  bumpStoryProgress,
  deleteShortStory,
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

// ---------- 创建与 brief 归一化 ----------
{
  const s = createShortStory({ title: '雨夜重逢', brief: { theme: '爱情', targetWords: 5000, hackerField: 'x' } });
  assertOk(s.id.startsWith('ss_') && s.title === '雨夜重逢' && s.status === 'draft', '创建短篇草稿(ss_ 前缀,draft)');
  assertOk(s.brief.theme === '爱情' && s.brief.targetWords === 5000, 'brief 归一化保留已知字段');
  assertOk(!('hackerField' in s.brief), 'brief 丢弃未知字段');

  const s2 = createShortStory({});
  assertOk(s2.title === '未命名短篇' && Object.keys(s2.brief).length === 0, '缺省标题与空 brief');

  const u = updateShortStory(s.id, { brief: { theme: '悬疑', targetWords: 999999 }, sourceUrl: null });
  assertOk(u.brief.theme === '悬疑' && u.brief.targetWords === 200000, 'brief 整体替换且 targetWords 收敛到上限');
  await assertThrows('SHORT_STORY_NOT_FOUND', () => updateShortStory('ss_nope', { title: 'x' }), '改不存在的主档 → SHORT_STORY_NOT_FOUND');
}

// ---------- 版本追加:只增不改 ----------
{
  const s = createShortStory({ title: '版本链' });
  const v1 = appendVersion(s.id, { content: '第一版正文', creationReason: 'generated', modelName: 'deepseek-chat' });
  assertOk(v1.version === 1 && v1.charCount === 5 && v1.modelName === 'deepseek-chat', 'V1 追加并记录字数/模型');
  const v2 = appendVersion(s.id, { content: '第二版正文(优化后)', creationReason: 'ai_optimized' });
  assertOk(v2.version === 2, 'V2 自动递增');
  const after = getShortStory(s.id);
  assertOk(after.currentVersionId === v2.id, '追加后 current_version_id 跟进最新版');
  assertOk(listStoryVersions(s.id).length === 2, '版本列表完整');
  await assertThrows('INVALID_INPUT', () => appendVersion(s.id, { content: '', creationReason: 'generated' }), '空正文 → INVALID_INPUT');
  await assertThrows('INVALID_INPUT', () => appendVersion(s.id, { content: 'x', creationReason: 'hack' as never }), '非法 creationReason → INVALID_INPUT');

  // 最终版:唯一标记 + current 同步
  setFinalVersion(s.id, v1.id);
  const detail = getStoryDetail(s.id);
  assertOk(detail.versions.find((v) => v.id === v1.id)?.isFinal === true, '设 V1 为最终版');
  assertOk(detail.versions.filter((v) => v.isFinal).length === 1, '最终版唯一');
  setFinalVersion(s.id, v2.id);
  const again = getStoryDetail(s.id);
  assertOk(
    again.versions.find((v) => v.id === v2.id)?.isFinal === true &&
      again.versions.find((v) => v.id === v1.id)?.isFinal === false,
    '切换最终版后旧标记清除'
  );
  await assertThrows('SHORT_STORY_VERSION_NOT_FOUND', () => getStoryVersion('ssv_nope'), '版本不存在 → SHORT_STORY_VERSION_NOT_FOUND');
}

// ---------- 状态流转 / 进度回写 / 删除守卫 ----------
{
  const s = createShortStory({ title: '流水线目标' });
  transitionStory(s.id, 'generating');
  assertOk(getShortStory(s.id).status === 'generating', '状态流转 generating');
  bumpStoryProgress(s.id, { reviewDelta: 1, optimizeDelta: 1, lastScore: 72 });
  bumpStoryProgress(s.id, { reviewDelta: 1, lastScore: 81 });
  const p = getShortStory(s.id);
  assertOk(p.reviewRound === 2 && p.optimizeRound === 1 && p.lastScore === 81, '评审/优化轮次自增与最近评分回写');
  await assertThrows('INVALID_INPUT', () => deleteShortStory(s.id), 'passed/generating 状态不可删');
  transitionStory(s.id, 'pool');
  deleteShortStory(s.id);
  assertOk(tryGetShortStory(s.id) === null, 'pool 状态可删,删后不存在');
  await assertThrows('SHORT_STORY_NOT_FOUND', () => getShortStory('ss_nope'), '主档不存在 → SHORT_STORY_NOT_FOUND');
}

// ---------- 列表过滤 ----------
{
  createShortStory({ title: '搜索关键字甲的故事' });
  createShortStory({ title: '无关作品' });
  transitionStory(createShortStory({ title: '已通过' }).id, 'passed');
  assertOk(listShortStories({ q: '关键字甲' }).length === 1, '标题模糊匹配');
  assertOk(listShortStories({ status: 'passed' }).every((x) => x.status === 'passed'), '状态筛选生效');
  const all = listShortStories();
  assertOk(all.length >= 3 && all[0].updatedAt >= all[all.length - 1].updatedAt, '全量列表按更新时间倒序');
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
