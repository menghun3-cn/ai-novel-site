/**
 * V9.5 阶段二补丁:调度器单实例互斥锁(SQLite 部署的 advisory lock 替代)
 *
 * 原理:data 目录下 scheduler.lock 文件,O_EXCL 独占创建,内容记录 pid/hostname/时间。
 *   - 持有者存活(process.kill(pid,0) 不抛错)→ 视为有效锁,第二个实例启动失败退出
 *   - 持有者已死(崩溃残留)→ 清理并接管(stale takeover)
 *   - 正常停止(SIGINT/SIGTERM)→ 删除锁文件释放
 *
 * 局限(与文档一致):仅保护同机部署。跨主机共享网络盘的部署不适用,
 * 请改用分布式锁或确保调度器只在一台主机运行。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface SchedulerLockHandle {
  /** 锁文件绝对路径 */
  lockPath: string;
  release(): void;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM:进程存在但属其他用户/受保护 → 视为存活
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockInfo(lockPath: string): { pid: number; hostname: string; at: string } | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw) as { pid?: number; hostname?: string; at?: string };
    if (typeof parsed.pid !== 'number') return null;
    return { pid: parsed.pid, hostname: parsed.hostname ?? '?', at: parsed.at ?? '?' };
  } catch {
    return null;
  }
}

/**
 * 尝试获取调度器互斥锁;失败返回 null(已有存活实例持有)。
 * dataDir 不存在时会自动创建。
 */
export function acquireSchedulerLock(dataDir: string): SchedulerLockHandle | null {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, 'scheduler.lock');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, hostname: os.hostname(), at: new Date().toISOString() }, null, 2)
        );
      } finally {
        fs.closeSync(fd);
      }
      let released = false;
      return {
        lockPath,
        release(): void {
          if (released) return;
          released = true;
          try {
            // 只删自己写的那把锁(内容 pid 校验),避免误删他人新锁
            const info = readLockInfo(lockPath);
            if (info?.pid === process.pid) fs.unlinkSync(lockPath);
          } catch {
            /* 已被清理则忽略 */
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // 锁文件已存在:检查持有者是否存活
      const info = readLockInfo(lockPath);
      if (info && isPidAlive(info.pid)) {
        return null;
      }
      // 崩溃残留:清理后重试一次(stale takeover)
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* 并发竞争时可能已被他人清理 */
      }
    }
  }
  return null;
}

/** 进程内单例:供调度器脚本 start/stop 使用 */
let currentLock: SchedulerLockHandle | null = null;

/** 启动时获取;失败打印诊断并返回 false(调用方应退出进程) */
export function ensureSchedulerSingleInstance(dataDir: string): boolean {
  currentLock = acquireSchedulerLock(dataDir);
  if (!currentLock) {
    const info = readLockInfo(path.join(dataDir, 'scheduler.lock'));
    console.error(
      `[scheduler] 另一实例似乎正在运行(pid=${info?.pid ?? '?'}, host=${info?.hostname ?? '?'}, since=${info?.at ?? '?'});` +
        '如确认无实例可在停止旧进程或删除 scheduler.lock 后重试'
    );
    return false;
  }
  const releaseOnce = (): void => currentLock?.release();
  process.once('exit', releaseOnce);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      releaseOnce();
    });
  }
  return true;
}
