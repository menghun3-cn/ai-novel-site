// V9 短篇创作/评审任务的后台执行器:立即返回,处理在进程内继续跑完。
// 与 serial-worker 同款考量:反代默认 60s 超时内不能同步等长 LLM 调用,
// kick 后由前端轮询 /api/admin/ai/tasks 取结果。
// 挂在 globalThis 上:开发模式 HMR 多实例间也只允许一个 worker。

import { processAiTasks, type ProcessedTaskResult } from '@novel/core';

const g = globalThis as unknown as { __storyWorker?: Promise<ProcessedTaskResult[]> };

export interface KickStoryWorkerResult {
  started: boolean;
  alreadyRunning: boolean;
}

/** 领取并执行一批 PENDING 的 ai_tasks(创作流水线/字段辅助/评审/优化) */
export function kickStoryWorker(limit = 10): KickStoryWorkerResult {
  if (g.__storyWorker) return { started: false, alreadyRunning: true };
  g.__storyWorker = processAiTasks({ limit })
    .catch(() => [])
    .finally(() => {
      g.__storyWorker = undefined;
    });
  return { started: true, alreadyRunning: false };
}
