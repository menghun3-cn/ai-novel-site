# Agent Note: 低配 1.8G 主机 kokoro/next-server 内存调优

Status: implemented

English | [中文](2026-09-04-lowmem-kokoro-tuning.zh.md)

## Problem

生产主机 hcss-ecs-8245 为 **2 核 / 1.8 GiB 内存**(不可扩容)。实测 kokoro 本地合成
性能极差:20 字 7s、50 字 18~27s、100 字 **176~338s**(60s 超时被 CPU 阻塞吞掉)。

内存账本(调优前):
- next-server(novel-web 容器) **~1.0~1.19 GB**(V8 堆未限,Node 默认堆≈物理内存一半,GC 惰性);
- sub2api-postgres **~0.65 GB**(多个 postgres 进程,不可停);
- 系统其余 + docker 守护 **~0.3 GB**;
- swap 已用 **1.86 GB**,可用内存仅 31~83 MB。

**根因**:物理内存被 next-server 堆膨胀吃满 → 内核把 kokoro 推理的临时内存
(模型权重 92MB onnx + 中间张量)持续换页到 swap → 100 字推理大部分时间在
磁盘换页,才出现 176s 的「假慢」。这是内存压力问题,不是 CPU 算力问题。

约束:硬件不可加;sub2api / tgmeng(Java)不可停;novel-reader(PM2,7MB)可停。

## Decision

### 1. 立即生效(服务器现场,无需发版)
- `pm2 stop ai-novel-reader` + `pm2 save`(释放 CPU/内存,重启不拉起);
- `echo 3 > /proc/sys/vm/drop_caches` 释放 page cache;
- `vm.vfs_cache_pressure=200` 并写入 `/etc/sysctl.conf`(内核更积极回收文件缓存);
- `vm.swappiness=0` 已是既有值(不依赖 swap 兜底)。

### 2. 仓库化(compose 发版后生效)
`docker-compose.yml`:
- web 服务加 `NODE_OPTIONS: "--max-old-space-size=768"` —— 限制 V8 老生代堆,
  强制 GC 更积极,阻止 next-server RSS 膨胀到 1GB+(这是本轮最大的内存释放点);
- web 服务加 `mem_limit: 1500m`(留 kokoro 推理余量);
- scheduler 加 `mem_limit: 256m`(常驻循环内存需求小)。

### 3. 前端切片(已有,确认无需改)
TtsPlayer 已按 ≤200 字/片(`splitIntoChunks` + `maxChunkLength`)切片,
单次合成文本长度已是最优,无需改动。

## Alternatives considered

**给 postgres 限内存。** 否决:postgres 是 sub2api 的数据库,不可停且共享内存
模型(multiple backends)限制不当易 OOM;省下空间有限(~0.65G 里可压缩部分小)。

**关 swap。** 否决:swapoff 需要先把 1.86G 换页内容搬回内存,当前可用内存不足,
会直接 OOM;调优目标是减少换页而非强行清零。

**降低 WAV 采样率(24k→16k)。** 否决:省的是输出缓冲与带宽,CPU 推理时间
几乎不变,对 176s 问题无实质帮助,且改动引擎输出会动到测试基线。

## Consequences

- 核心收益:next-server 堆受限后 RSS 预计降到 ~700-800MB,腾出 ~300MB 给
  kokoro 推理驻留内存,换页风暴显著缓解,合成耗时应大幅回落(目标 100 字 <30s);
- 若仍不足:下一步可考虑 postgres 容器 `mem_limit`(需 sub2api 侧确认)或
  将 kokoro 推理线程数限到 1~2(2 核机器减少线程切换抖动);
- `NODE_OPTIONS` 只影响 next-server 进程,不影响容器内其它命令;
- mem_limit 是容器硬上限:超限会被内核 OOM kill 而非无边界膨胀,便于发现回归。

与 [2026-09-03-local-kokoro-tts](../feature/2026-09-03-local-kokoro-tts.md) 关联:
同属 kokoro 引擎的线上可用性链路(可用性 = 依赖/模型就绪 + 有内存推理)。
与 [2026-09-04-kokoro-synthesis-serialization](../bug-fix/2026-09-04-kokoro-synthesis-serialization.md) 关联:
本笔记解决「next-server 堆膨胀吃满内存导致换页风暴」,后者解决「并发合成叠加
内存峰值 + 长文本撞 CF 回源超时墙(502/524)」——同一主机约束下的两轮递进修复。
