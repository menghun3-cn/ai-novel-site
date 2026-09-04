# Agent Note: kokoro 合成串行化 + 文本上限,消除低配主机 502/524

Status: implemented

English | [中文](2026-09-04-kokoro-synthesis-serialization.zh.md)

## Problem

线上听书使用 kokoro 本地引擎时报 **502 Bad Gateway**(CF 透传 nginx 的 502)
与 **524 回源超时**(CF 直接掐断)。用户误以为 CF 拦截,实测证据链:

- 源站直连 GET /api/tts → 200,0.09s(引擎探测正常);
- 源站直连 POST 20 字 → 200,4.6s(小文本正常);
- 源站直连 POST **200 字 → 180s 无响应**(长文本爆炸);
- 公网经 CF POST 20 字 → **524**,136.9s(CF 免费版回源超时约 100s,硬墙);
- 主机 available 仅 15~23MB,next-server RSS 1.32GB,load 28~31。

根因链:**主机 1.8G 内存被 next-server + postgres 吃满 → kokoro 合成需要峰值
内存时全部换页到 swap → 20 字正常 4.6s、200 字变成 180s+ → CF 等 100s 等不到
→ 524/502**。并发合成(多个用户同时听书)把内存峰值叠加,是换页风暴的直接推手。

nginx `proxy_read_timeout 300s` 不是瓶颈:CF 免费版回源超时(~100s)先掐断,
改 nginx 时间无效,必须在 100s 内出结果。

## Decision

### 1. kokoro 合成串行化(kokoro-server.ts)
`synthesizeKokoro` 改为 promise 链互斥队列(`synthesisQueue`):同一时刻只跑
一个 onnxruntime CPU 推理,后续请求排队;队列不因单次失败而断。
并发听书的内存峰值从此不再叠加——这是换页风暴的直接解药。

### 2. kokoro 单次文本上限(route.ts)
`KOKORO_MAX_TEXT = 300`:超过即 400 拒绝。前端 TtsPlayer 实际切片约 52 字/次
(`maxChunkLength` 1x 语速),300 字远高于真实请求,只拦截手误/恶意长文本
(route.ts 原 `MAX_TEXT=2000` 对 kokoro 太宽,长文本必撞 CF 100s 超时墙)。

### 3. next-server 堆保持 768MB(不降)
内存细分(smaps):RSS 1.05GB 中 V8 堆仅 ~157MB(受 768MB 上限约束、GC 正常),
大头是 onnxruntime 原生内存(模型 92MB + 中间张量)+ Next.js 运行时本身。
堆再降到 512MB 收益有限且有 OOM 风险——真正有效的是串行化(防峰值叠加),
而非继续压堆。

## Alternatives considered

**改 nginx proxy_read_timeout / connect_timeout。** 否决:CF 免费版回源超时
~100s 是硬墙(企业版才可调),nginx 300s 已远超之,请求在 CF 层先被掐断,
改 nginx 无效。

**前端切片更小。** 否决:已按语速动态切片(1x 约 52 字/次,12s 音频预算),
再小会增加请求数、放大串行队列的排队延迟,收益为负。

**模型换 fp32→q8 更小量化。** 否决:已是 q8(82M,~80MB),无更小档。

**降低 WAV 采样率 24k→16k。** 否决:省的是输出带宽,CPU 推理时间不变,
对 100s 超时墙无实质帮助。

## Consequences

- 并发听书不再叠加内存峰值,单合成耗时回到调优后的正常区间
  (20 字 ~5-8s / 50 字 ~13-14s / 100 字 ~23-25s),CF 100s 墙内可完成;
- 串行队列会让并发请求排队:低配机上并发越多、单请求等待越长,但
  比 OOM/换页风暴(整机不可用)好一个量级;前端 20s 超时 + 重试 2 次兜底;
- 文本上限 300 字对前端零影响(实际 52 字/次),只挡异常请求;
- 下一步(若仍不足):把 postgres 迁出或限容、加内存,或上 CF 企业版调回源超时。

与 [2026-09-04-lowmem-kokoro-tuning](../bug-fix/2026-09-04-lowmem-kokoro-tuning.md) 关联:
上一轮解决「内存被 next-server 堆膨胀吃满」,本轮解决「并发合成叠加峰值 + 长文本撞超时墙」。
