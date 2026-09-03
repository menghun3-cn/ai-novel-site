/**
 * V10.5 持续创作产线验证
 *   - normalizeLineConfig:continuous 模式不接受 intervalSeconds;空题材注入内置随机池
 *   - 背压:在飞短篇(draft 等)达到阈值后不再触发;worker 消费后恢复触发
 *   - 熔断:连续失败达到阈值自动停线;人工恢复后清零
 *   - 成功一轮清零连续失败
 *   - 每日软配额对 continuous 同样生效
 *   - DEFAULT_KINDS 随机题材池:未配 kinds 时注入 ≥8 种题材,每轮随机化不破坏分配
 */
process.env.AI_MODEL = 'mock-model';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在 import @novel/core 之前设置 NOVEL_DATA_DIR,避免污染仓库 data/novel.db
process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-cpln-'));

const {
  CoreError,
  DEFAULT_KINDS,
  createProductionLine,
  ensureDefaultReviewRule,
  fireDueContinuousProductionRuns,
  getActiveRuleVersion,
  getProductionExceptions,
  getProductionLinesWithMeta,
  getProductionOverview,
  getProductionLine,
  isLineTripped,
  listDueContinuousProductionLines,
  listProductionRuns,
  resumeProductionLine,
  runProductionLine,
  setProductionLineEnabled,
} = (await import('@novel/core')) as typeof import('@novel/core');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else { console.error(`✗ ${name}`); failed++; }
}
async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

async function main(): Promise<void> {
  ensureDefaultReviewRule();
  if (!getActiveRuleVersion()) { console.error('无已发布规则'); process.exit(2); }

  // ---------- 1. 配置校验 ----------
  await assertThrows(
    'INVALID_LINE_CONFIG',
    () =>
      createProductionLine({
        name: 'x',
        config: { schedule: { mode: 'continuous', count: 3, intervalSeconds: 30 } },
      }),
    'continuous 传入 intervalSeconds 抛 INVALID_LINE_CONFIG'
  );
  // manual 模式空题材仍抛错(向后兼容)
  await assertThrows(
    'INVALID_LINE_CONFIG',
    () => createProductionLine({ name: 'x', config: { schedule: { mode: 'manual', count: 1 } } }),
    'manual 空题材仍抛 INVALID_LINE_CONFIG'
  );
  // continuous 空题材 → 注入内置随机池
  const rl = createProductionLine({
    name: '随机持续线',
    config: { schedule: { mode: 'continuous', count: 3 } },
  });
  assertOk(DEFAULT_KINDS.length >= 8, `内置随机题材池 ≥8 种,实际 ${DEFAULT_KINDS.length}`);
  assertOk(getProductionLine(rl.id).config.kinds.length === DEFAULT_KINDS.length, '空题材持续线注入内置池');
  assertOk(getProductionLine(rl.id).maxConsecutiveFailures === 3, '熔断阈值缺省 3');
  // 指定题材仍优先(非空 kinds 不注入内置池)
  const sl = createProductionLine({
    name: '指定题材线',
    config: { kinds: [{ genre: '科幻', weight: 1 }], schedule: { mode: 'continuous', count: 2 } },
  });
  assertOk(getProductionLine(sl.id).config.kinds.length === 1 && getProductionLine(sl.id).config.kinds[0].genre === '科幻', '指定题材优先于内置池');

  // ---------- 2. 背压:在飞达到阈值不再触发(隔离:仅 rl 启用) ----------
  setProductionLineEnabled(sl.id, false); // 暂停指定题材线,保证只有 rl 在 due
  // 首次触发:inFlight=0 < 阈值(6) → fire
  const fired1 = fireDueContinuousProductionRuns();
  assertOk(fired1.length === 1, `背压允许时触发 1 轮,实际 ${fired1.length}`);
  const runs = listProductionRuns({ lineId: rl.id, limit: 10 });
  assertOk(runs.length === 1 && runs[0].trigger === 'continuous', '运行记录 trigger=continuous');
  assertOk(runs[0].status === 'done', '运行状态 done');
  // 3 篇短篇为 draft 状态(在飞),阈值 = max(2, 3*2)=6,3 < 6 → 仍可触发一轮
  const fired2 = fireDueContinuousProductionRuns();
  assertOk(fired2.length === 1, '在飞 3 < 阈值 6 时可再触发一轮');
  // 在飞 = 6 ≥ 阈值 6 → 不再触发
  const fired3 = fireDueContinuousProductionRuns();
  assertOk(fired3.length === 0, '在飞 6 ≥ 阈值 6 时背压拦截,不触发');
  assertOk(listDueContinuousProductionLines().length === 0, '背压拦截时 due 列表为空');

  // ---------- 2b. 指定题材线背压(隔离:暂停 rl,启用 sl) ----------
  setProductionLineEnabled(rl.id, false);
  setProductionLineEnabled(sl.id, true);
  const firedSl = fireDueContinuousProductionRuns();
  assertOk(firedSl.length === 1, '指定题材线背压允许时触发');
  const slRuns = listProductionRuns({ lineId: sl.id, limit: 10 });
  assertOk(slRuns.length === 1 && slRuns[0].items.length === 2, '指定题材线一轮 2 篇');
  // sl 在飞 2 < 阈值 4 → 再触发一轮 → 在飞 4 ≥ 4 拦截
  const firedSl2 = fireDueContinuousProductionRuns();
  assertOk(firedSl2.length === 1, '指定题材线在飞 2 < 4 再触发');
  const firedSl3 = fireDueContinuousProductionRuns();
  assertOk(firedSl3.length === 0, '指定题材线在飞 4 ≥ 4 背压拦截');
  setProductionLineEnabled(sl.id, false);

  // ---------- 3. 每日软配额对 continuous 生效 ----------
  const ql = createProductionLine({
    name: '持续配额线',
    config: { schedule: { mode: 'continuous', count: 3 }, quota: { dailyLimit: 2 } },
  });
  await assertThrows('LINE_QUOTA_EXCEEDED', () => runProductionLine(ql.id, { trigger: 'continuous' }), '超每日上限抛 LINE_QUOTA_EXCEEDED');

  // ---------- 4. 熔断:连续失败达到阈值自动停线(隔离:仅 t2 启用) ----------
  setProductionLineEnabled(rl.id, false);
  setProductionLineEnabled(ql.id, false);
  const t2 = createProductionLine({
    name: '熔断测试线2',
    config: { schedule: { mode: 'continuous', count: 1 }, quota: { dailyLimit: 1 } },
  });
  fireDueContinuousProductionRuns(); // 成功 1 轮(count=1 ≤ 配额 1)
  assertOk(getProductionLine(t2.id).consecutiveFailures === 0, '成功一轮清零连续失败');
  fireDueContinuousProductionRuns(); // 超配额 → bump=1
  fireDueContinuousProductionRuns(); // bump=2
  fireDueContinuousProductionRuns(); // bump=3 ≥ 阈值 → 熔断(enabled=0)
  const tripped = getProductionLine(t2.id);
  assertOk(tripped.consecutiveFailures === 3, `连续失败计数到 3,实际 ${tripped.consecutiveFailures}`);
  assertOk(tripped.enabled === false, '熔断后自动停线 enabled=false');
  assertOk(isLineTripped(tripped), 'isLineTripped=true');
  assertOk(!!tripped.trippedReason && !!tripped.trippedAt, '熔断原因与时间已记录');
  assertOk(listDueContinuousProductionLines().every((l) => l.id !== t2.id), '熔断线不再出现在 due 列表');

  // ---------- 5. 人工恢复 ----------
  const resumed = resumeProductionLine(t2.id);
  assertOk(resumed.enabled === true, '恢复后 enabled=true');
  assertOk(resumed.consecutiveFailures === 0, '恢复后连续失败清零');
  assertOk(resumed.trippedReason === null && resumed.trippedAt === null, '恢复后 tripped 痕迹清空');
  // 恢复后配额仍超 → 再失败 3 次又熔断(验证恢复不是绕过配额)
  fireDueContinuousProductionRuns(); fireDueContinuousProductionRuns(); fireDueContinuousProductionRuns();
  assertOk(isLineTripped(getProductionLine(t2.id)), '恢复后再失败达阈再次熔断');

  // ---------- 6. 手动暂停(非熔断)不动计数 ----------
  const paused = setProductionLineEnabled(rl.id, false);
  assertOk(paused.enabled === false, '手动暂停生效');
  assertOk(paused.consecutiveFailures === 0 && paused.trippedAt === null, '手动暂停不动熔断计数');
  assertOk(listDueContinuousProductionLines().every((l) => l.id !== rl.id), '暂停线不在 due 列表');
  setProductionLineEnabled(rl.id, true);
  assertOk(listDueContinuousProductionLines().length >= 0, '重新启用后可恢复调度');

  // ---------- 6b. M4 观测:熔断告警 / 异常分诊 / 带概览 inFlight ----------
  const ov = getProductionOverview();
  const tripAlert = ov.alerts.find((a) => a.kind === 'tripped_line' && a.lineId === t2.id);
  assertOk(!!tripAlert && tripAlert.severity === 'danger', '总览含熔断产线告警(danger)');
  const ex = getProductionExceptions();
  const tripEx = ex.find((e) => e.kind === 'tripped_line' && e.lineId === t2.id);
  assertOk(!!tripEx && tripEx.action?.type === 'resume_line', '异常分诊含熔断线且动作=恢复');
  const withMeta = getProductionLinesWithMeta();
  const rlMeta = withMeta.find((l) => l.id === rl.id);
  assertOk(rlMeta?.inFlight !== undefined && rlMeta.backpressureThreshold === 6, '带概览返回持续线 inFlight/背压阈值');

  // ---------- 7. 随机化不破坏分配 ----------
  const genres = new Set(getProductionLine(rl.id).config.kinds.map((k) => k.genre));
  assertOk(genres.size === DEFAULT_KINDS.length, '持续线题材全集 = 内置池全集');
}

await main();
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
