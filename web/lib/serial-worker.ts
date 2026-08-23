// AI 生成队列的后台执行器:立即返回,处理在进程内继续跑完。
// 部署在反代(nginx/宝塔等,默认 60s)后面时,同步等待长 LLM 调用会触发 504;
// 改为 kick 后由前端轮询任务列表取结果。
// 挂在 globalThis 上:开发模式 HMR 多实例间也只允许一个 worker。

import { processGenerationJobs } from '@novel/core';

const g = globalThis as unknown as { __serialWorker?: Promise<{ processed: number }> };

export interface KickResult {
  started: boolean;
  alreadyRunning: boolean;
}

export function kickProcessing(limit = 20): KickResult {
  if (g.__serialWorker) return { started: false, alreadyRunning: true };
  g.__serialWorker = processGenerationJobs(limit)
    .catch(() => ({ processed: 0 }))
    .finally(() => {
      g.__serialWorker = undefined;
    });
  return { started: true, alreadyRunning: false };
}
