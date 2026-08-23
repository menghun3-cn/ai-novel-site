/**
 * 调度器:常驻进程,每 tick 依次执行
 *   1) runPublishCycle()          — 到期定时章节转发布 + 每书每日自动发布(V3)
 *   2) runAiSerializationCycle()  — 每书每日 AI 连载:入队生成→质检→送审/发布(V5)
 *
 * 运行:npm run scheduler
 * 环境变量:
 *   NOVEL_DATA_DIR         数据目录(默认仓库 data/)
 *   PUBLISH_TICK_SECONDS   扫描间隔,默认 60 秒(下限 5)
 */
import { runAiSerializationCycle, runPublishCycle, type SerializationCycleResult } from '@novel/core';

const tickSeconds = Number(process.env.PUBLISH_TICK_SECONDS ?? 60);
if (!Number.isFinite(tickSeconds) || tickSeconds < 5) {
  console.error(`[scheduler] PUBLISH_TICK_SECONDS must be a number >= 5, got: ${process.env.PUBLISH_TICK_SECONDS}`);
  process.exit(1);
}

let running = true;

async function tick(): Promise<void> {
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
