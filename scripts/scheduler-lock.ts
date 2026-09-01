/**
 * V9.5 阶段二补丁:调度器单实例互斥锁(SQLite 部署的 advisory lock 替代)
 *
 * 原理:data 目录下 scheduler.lock 文件,O_EXCL 独占创建,内容记录 pid/hostname/时间(at)。
 * 持有者每个 tick 调用 refreshSchedulerLock() 续约(刷新 at)。
 *   - 同宿主(容器)内挑战者:pid 必须确实是本调度脚本进程才算活持有者——
 *     防容器重启后 pid 被其他进程复用(npx tsx 启动链里的 esbuild 服务会占用
 *     固定低位 pid,导致"崩溃残留"永远被误判为存活,锁永远无法接管)
 *   - 不同宿主(容器)间挑战者:无法跨 pid 命名空间验证,以续约时间为准——
 *     持有者每 tick 续约,锁超过 STALE_GRACE_MS 未续约即判定持有者容器已死(重建/重启/被杀)
 *   - 判定为 stale → 清理并接管;判定为活持有者 → 第二个实例启动失败退出
 *   - 正常停止(SIGINT/SIGTERM)→ 立即释放锁并退出:不等 tick 睡完,避免超出
 *     docker 宽限期被 SIGKILL 后锁残留(残留 + 上述误判曾导致重建后调度器永久停摆)
 *
 * 局限(与文档一致):仅保护同机部署(同宿主多容器);跨主机共享网络盘的部署
 * 不适用,请改用分布式锁或确保调度器只在一台主机运行。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface SchedulerLockHandle {
  /** 锁文件绝对路径 */
  lockPath: string;
  /** 持有者续约:刷新 at 时间戳(不同宿主判定持有者存活的依据),调用方每 tick 一次 */
  refresh(): void;
  release(): void;
}

/** 不同宿主(容器)间:锁超过此时长未续约 → 判定持有者已死 */
const STALE_GRACE_MS = 3 * 60 * 1000;

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

/**
 * 判断 pid 是否确为本调度脚本进程(读 /proc/<pid>/cmdline,仅 Linux 可确定)。
 * 返回 null 表示无法确定(非 Linux 或进程已消失),调用方回退 isPidAlive 保守判断。
 */
function isSchedulerPid(pid: number): boolean | null {
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
    return cmdline.includes('publish-scheduler');
  } catch {
    return null;
  }
}

function readLockInfo(lockPath: string): { pid: number; hostname: string; at: number | null } | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw) as { pid?: number; hostname?: string; at?: string };
    if (typeof parsed.pid !== 'number') return null;
    const at = parsed.at ? Date.parse(parsed.at) : NaN;
    return { pid: parsed.pid, hostname: parsed.hostname ?? '?', at: Number.isFinite(at) ? at : null };
  } catch {
    return null;
  }
}

/**
 * 判定锁记录是否为活持有者:
 * - 同宿主(同容器/同机):pid 必须确实是调度脚本进程才算活(防 pid 复用误判);
 *   非 Linux 无法读 cmdline 时回退 kill(0),保守判活
 * - 不同宿主(不同容器):无法跨 pid 命名空间验 pid,以续约时间为准
 *   (持有者每 tick 续约;at 缺失视为旧格式/已失效,按 stale 处理)
 */
function isLiveHolder(info: { pid: number; hostname: string; at: number | null }, myHostname: string): boolean {
  if (info.hostname === myHostname) {
    const ours = isSchedulerPid(info.pid);
    if (ours !== null) return ours;
    return isPidAlive(info.pid);
  }
  return info.at !== null && Date.now() - info.at <= STALE_GRACE_MS;
}

function makeHandle(lockPath: string): SchedulerLockHandle {
  let released = false;
  const isMine = (): boolean => readLockInfo(lockPath)?.pid === process.pid;
  return {
    lockPath,
    refresh(): void {
      if (released) return;
      try {
        if (!isMine()) return;
        fs.writeFileSync(
          lockPath,
          JSON.stringify({ pid: process.pid, hostname: os.hostname(), at: new Date().toISOString() }, null, 2)
        );
      } catch {
        /* 锁已被接管则忽略 */
      }
    },
    release(): void {
      if (released) return;
      released = true;
      try {
        // 只删自己写的那把锁(内容 pid 校验),避免误删他人新锁
        if (isMine()) fs.unlinkSync(lockPath);
      } catch {
        /* 已被清理则忽略 */
      }
    },
  };
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
      return makeHandle(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // 锁文件已存在:检查持有者是否存活
      const info = readLockInfo(lockPath);
      if (info && isLiveHolder(info, os.hostname())) {
        return null;
      }
      // 持有者已死/记录失效:清理后重试一次(stale takeover)
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* 并发竞争时可能已被他人清理 */
      }
    }
  }
  return null;
}

/** 进程内单例:供调度器脚本 start/stop/refresh 使用 */
let currentLock: SchedulerLockHandle | null = null;

/** 持有者续约:调度循环每 tick 调一次,让不同宿主能区分活/死持有者 */
export function refreshSchedulerLock(): void {
  currentLock?.refresh();
}

/** 启动时获取;失败打印诊断并返回 false(调用方应退出进程) */
export function ensureSchedulerSingleInstance(dataDir: string): boolean {
  currentLock = acquireSchedulerLock(dataDir);
  if (!currentLock) {
    const info = readLockInfo(path.join(dataDir, 'scheduler.lock'));
    console.error(
      `[scheduler] 另一实例正在运行(pid=${info?.pid ?? '?'}, host=${info?.hostname ?? '?'}, since=${
        info?.at !== null ? new Date(info.at).toISOString() : '?'
      });如确认无实例可在停止旧进程或删除 scheduler.lock 后重试`
    );
    return false;
  }
  const releaseOnce = (): void => currentLock?.release();
  process.once('exit', releaseOnce);
  // 收到停止信号立即释放锁并退出:若等 tick 睡完(最长 60s)再退出,会超出
  // docker 默认 10s 宽限期被 SIGKILL,锁文件残留并阻塞容器重建后的重启
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      releaseOnce();
      process.exit(0);
    });
  }
  return true;
}
