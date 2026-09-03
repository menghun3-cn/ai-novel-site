# Agent Note: scheduler-lock test must match the cross-host renewal semantics

Status: implemented

English | [中文](2026-09-03-scheduler-lock-test-cross-host-renewal.zh.md)

## Problem

`scripts/verify-scheduler-lock.ts` 第 4 步模拟崩溃残留时写入 `{ pid: 999999999, hostname: 'ghost', at: <当前时间> }` 并断言锁被接管。自 `29b21a3`(根治 scheduler.lock 卡死导致定时停摆)起,持有者判定规则已升级——同宿主按 `/proc/<pid>/cmdline` 核验身份;**跨宿主按续约时间判定(`at` 在 `STALE_GRACE_MS` 内即视为存活)**。该夹具现在是"跨宿主存活持有者":`at` 是新鲜的,`acquireSchedulerLock()` 正确地返回 `null`,测试随即在 `lock3!.release()` 崩溃(`Cannot read properties of null`)。

测试早于跨宿主续约规则,且从未随之更新,`npm run test:scheduler-lock` 在 develop 上一直失败。

## Decision

让测试与已交付的存活语义对齐,把旧的单一「死 pid」用例拆成实现实际执行的三种不同规则:

1. **同宿主死 pid**(hostname = 当前宿主,pid 不存在)→ 接管(cmdline 校验失败,`isPidAlive` 为 false)。
2. **跨宿主过期**(不同宿主,`at` 早于 `STALE_GRACE_MS`)→ 接管。
3. **跨宿主新鲜**(不同宿主,`at` 在宽限期内)→ 视为存活持有者;`acquireSchedulerLock()` 返回 `null` 且锁文件原样保留(测试中手动清理)。

损坏锁接管、以及「release 不得误删他人锁」用例保持不变。文件头注释现在枚举了全部覆盖的规则。

## Alternatives considered

**改实现,把所有跨宿主锁一律视为 stale。**
否决:`29b21a3` 刻意引入基于续约的规则——重建后的容器(新 hostname,共享同一锁文件)不能瞬间接管仍在运行的兄弟容器持有的锁;回退会重新引入它修掉的双调度器竞争。

**删掉「跨宿主新鲜」断言,只修夹具。**
否决:那正是旧夹具意外命中的场景;显式断言它,才能让测试记录规则而不是被规则绊倒。

## Consequences

- `npm run test:scheduler-lock` 恢复全绿(POSIX 13 项断言;Windows 12 项 + 一项平台跳过)。
- 测试现在覆盖同宿主 stale、跨宿主 stale、跨宿主存活三类持有者——`isLiveHolder` 的完整决策面,未来改动存活规则会在此响亮失败。
- 未改动任何生产代码;`scheduler-lock.ts` 行为保持不变。
