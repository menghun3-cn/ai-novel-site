/**
 * V9.5 阶段二补丁:调度器单实例互斥锁
 * - 首次获取成功;重复获取失败(持有者存活)
 * - release 后可重新获取
 * - 同宿主崩溃残留(死 pid)→ 自动接管
 * - 跨宿主 + 超过 STALE_GRACE_MS 未续约 → 自动接管
 * - 跨宿主 + 宽限期内续约 → 视为存活,拒绝接管
 * - 锁内容损坏/不可读 → 视为 stale,接管
 * - release 只删自己的锁:他人新锁不被误删
 *
 * 运行:npm run test:scheduler-lock
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-scheduler-lock-'));

const { acquireSchedulerLock } = await import('./scheduler-lock');

let failed = 0;
function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

const dataDir = process.env.NOVEL_DATA_DIR;
const lockPath = path.join(dataDir, 'scheduler.lock');

// 1. 首次获取
const lock1 = acquireSchedulerLock(dataDir);
assertOk(lock1 !== null, '首次获取成功');
assertOk(fs.existsSync(lockPath), '锁文件已创建');
const info1 = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid: number };
assertOk(info1.pid === process.pid, '锁内容记录当前 pid');

// 2. 持有期间重复获取 → 失败
assertOk(acquireSchedulerLock(dataDir) === null, '持有期间二次获取失败');

// 3. 释放后可重新获取
lock1!.release();
assertOk(!fs.existsSync(lockPath), 'release 删除锁文件');
const lock2 = acquireSchedulerLock(dataDir);
assertOk(lock2 !== null, '释放后可重新获取');

// 4. 同宿主崩溃残留:写入不存在的 pid(hostname 与当前一致)→ 接管
lock2!.release();
fs.writeFileSync(
  lockPath,
  JSON.stringify({ pid: 999999999, hostname: os.hostname(), at: new Date().toISOString() })
);
const lock3 = acquireSchedulerLock(dataDir);
assertOk(lock3 !== null, '同宿主死 pid 锁被自动接管');

// 5. 跨宿主崩溃残留:不同宿主 + 超过 STALE_GRACE_MS 未续约 → 接管
lock3!.release();
fs.writeFileSync(
  lockPath,
  JSON.stringify({ pid: 1, hostname: 'ghost', at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
);
const lock4 = acquireSchedulerLock(dataDir);
assertOk(lock4 !== null, '跨宿主过期锁被自动接管');

// 6. 跨宿主存活持有者:不同宿主 + 续约时间在宽限期内 → 拒绝接管
lock4!.release();
fs.writeFileSync(
  lockPath,
  JSON.stringify({ pid: 1, hostname: 'ghost', at: new Date().toISOString() })
);
assertOk(acquireSchedulerLock(dataDir) === null, '跨宿主新鲜续约视为存活,拒绝接管');
fs.unlinkSync(lockPath); // 清理

// 7. 锁文件损坏 → 接管
const lock5 = acquireSchedulerLock(dataDir);
assertOk(lock5 !== null, '重建锁');
lock5!.release();
fs.writeFileSync(lockPath, 'not-json{{');
const lock6 = acquireSchedulerLock(dataDir);
assertOk(lock6 !== null, '损坏锁文件被自动接管');

// 8. release 不误删他人新锁
lock6!.release();
// 模拟他人持有(存活 pid = 当前进程,但 release 由 lock6 的句柄做)
const foreign = acquireSchedulerLock(dataDir);
assertOk(foreign !== null, '重建锁');
// 手动把内容改成"别人的 pid"(用 1 —— 系统进程,必存活)
fs.writeFileSync(lockPath, JSON.stringify({ pid: 1, hostname: 'other', at: new Date().toISOString() }));
foreign!.release();
if (process.platform === 'win32') {
  // Windows 下 pid=1 不可探测为存活(isPidAlive 可能返回 false),此断言仅在 POSIX 有意义
  console.log('· 跳过「不误删他人锁」断言(win32 pid=1 存活性不可靠)');
} else {
  assertOk(fs.existsSync(lockPath), 'release 不误删他人(pid=1)的新锁');
  fs.unlinkSync(lockPath); // 清理
}

console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
