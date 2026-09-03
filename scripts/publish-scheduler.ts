/**
 * 调度器:常驻进程,每 tick 依次执行
 *   1) runScheduleCycle()        — V9.5 阶段二补丁:到点的短篇定时创作(scheduled → generating + 入队)
 *   2) runPublishCycle()          — 到期定时章节转发布 + 每书每日自动发布(V3)
 *   3) runAiSerializationCycle()  — 每书每日 AI 连载:入队生成→质检→送审/发布(V5)
 *   4) processAiTasks({limit:5})  — V9 阶段二:长篇章节评审/弧级评审等后台任务(V9.5)
 *
 * 运行:npm run scheduler
 * 环境变量:
 *   NOVEL_DATA_DIR         数据目录(默认仓库 data/)
 *   PUBLISH_TICK_SECONDS   扫描间隔,默认 60 秒(下限 5)
 *
 * 单实例互斥:启动时获取 <数据目录>/scheduler.lock(O_EXCL + pid 存活检测,崩溃残留自动接管)。
 * 第二个实例会启动失败退出;NOVEL_SCHEDULER_LOCK=0 可跳过锁(自行保证单实例时使用)。
 */
import {
  enqueueCreationPipeline,
  fireBatchSchedule,
  fireDueContinuousProductionRuns,
  fireDueDailyProductionRuns,
  fireScheduledStory,
  getDataDir,
  listDueBatchSchedules,
  listDueScheduledShortStories,
  processAiTasks,
  runAiSerializationCycle,
  runPublishCycle,
  type SerializationCycleResult,
} from '@novel/core';
import { ensureSchedulerSingleInstance, refreshSchedulerLock } from './scheduler-lock';

const tickSeconds = Number(process.env.PUBLISH_TICK_SECONDS ?? 60);
if (!Number.isFinite(tickSeconds) || tickSeconds < 5) {
  console.error(`[scheduler] PUBLISH_TICK_SECONDS must be a number >= 5, got: ${process.env.PUBLISH_TICK_SECONDS}`);
  process.exit(1);
}

// 单实例互斥(可用 NOVEL_SCHEDULER_LOCK=0 显式关闭)
if (process.env.NOVEL_SCHEDULER_LOCK !== '0') {
  if (!ensureSchedulerSingleInstance(getDataDir())) {
    process.exit(1);
  }
}

let running = true;

/**
 * 扫描已到点的短篇定时任务(单篇 + 批量),逐个触发并入队创作流水线。
 * - 单篇:fireScheduledStory 把 status=generating + 清空 scheduled_at 一步完成(防重入),
 *   之后 enqueueCreationPipeline 入队 CREATE_NOVEL
 * - 批量:fireBatchSchedule 原子认领(pending→executing)→ 创建 count 篇短篇(标题自动生成)
 *   并逐篇入队;processAiTasks 在同 tick 下一块处理
 */
function runScheduleCycle(): { dueCount: number; enqueued: number; batchFired: number; batchStories: number } {
  const due = listDueScheduledShortStories();
  let enqueued = 0;
  for (const item of due) {
    try {
      fireScheduledStory(item.id);
      enqueueCreationPipeline(item.id);
      enqueued++;
    } catch (err) {
      // 单条失败不影响其他:下轮自然重试(状态未变)
      console.error(
        `[${new Date().toISOString()}] schedule fire failed: id=${item.id} scheduledAt=${item.scheduledAt} err=`,
        err
      );
    }
  }
  let batchFired = 0;
  let batchStories = 0;
  const batches = listDueBatchSchedules();
  for (const batch of batches) {
    try {
      const { createdStoryIds } = fireBatchSchedule(batch.id);
      batchFired++;
      batchStories += createdStoryIds.length;
    } catch (err) {
      // 失败已由 fireBatchSchedule 落库(error 可见);下轮不再重复触发(status 已非 pending)
      console.error(
        `[${new Date().toISOString()}] batch schedule fire failed: id=${batch.id} scheduledAt=${batch.scheduledAt} err=`,
        err
      );
    }
  }
  return { dueCount: due.length, enqueued, batchFired, batchStories };
}

async function tick(): Promise<void> {
  // 续约锁:持有者每 tick 刷新 at,其他宿主据此区分活/死持有者(防双跑误接管)
  refreshSchedulerLock();
  // 1) 短篇定时到点(单篇 + 批量)
  try {
    const sch = runScheduleCycle();
    if (sch.enqueued > 0 || sch.batchFired > 0) {
      console.log(
        `[${new Date().toISOString()}] schedule: due=${sch.dueCount} enqueued=${sch.enqueued} batch=${sch.batchFired} stories=${sch.batchStories}`
      );
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] schedule cycle failed:`, err);
  }

  try {
    const result = runPublishCycle();
    const { duePublished, autopilotBooks, autopilotPublished } = result;
    if (duePublished > 0 || autopilotPublished > 0) {
      console.log(
        `[${new Date().toISOString()}] published: due=${duePublished} autopilot=${autopilotPublished} (books=${autopilotBooks})`
      );
    }
  } catch (err) {
    // 单次失败不终止调度器;错误完整落日志便于排查
    console.error(`[${new Date().toISOString()}] publish cycle failed:`, err);
  }

  try {
    const ai: SerializationCycleResult = await runAiSerializationCycle();
    if (ai.enqueued > 0 || ai.processed > 0) {
      console.log(
        `[${new Date().toISOString()}] ai-serial: triggered=${ai.booksTriggered} enqueued=${ai.enqueued} processed=${ai.processed}`
      );
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ai-serial cycle failed:`, err);
  }

  // V10.5 持续创作:背压驱动的无间隙生产(每 tick 检查一次;达到阈值自动熔断)
  try {
    const fired = fireDueContinuousProductionRuns();
    if (fired.length > 0) {
      console.log(`[${new Date().toISOString()}] continuous-production: fired=${fired.length}`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] continuous production cycle failed:`, err);
  }

  // V9 阶段二:统一处理 ai_tasks(章节评审/弧级评审/PROCESS 等待任务),后台驱动长篇评审
  try {
    const processed = await processAiTasks({ limit: 5 });
    if (processed.length > 0) {
      const ok = processed.filter((t) => t.ok).length;
      const fail = processed.filter((t) => !t.ok).length;
      console.log(
        `[${new Date().toISOString()}] ai-tasks: picked=${processed.length} ok=${ok} fail=${fail}`
      );
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ai-tasks process failed:`, err);
  }
}

async function loop(): Promise<void> {
  console.log(`[scheduler] started, tick=${tickSeconds}s`);
  while (running) {
    await tick();
    await new Promise((r) => setTimeout(r, tickSeconds * 1000));
  }
  console.log('[scheduler] stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

void loop();
