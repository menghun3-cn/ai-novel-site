# Agent Note: 后台化章节生成

Status: implemented

English | [中文](2026-08-24-background-generation.md)

## Problem

部署在反向代理(nginx/宝塔默认 60s)后面时,点 生成章节草稿 直接 HTTP 504:
路由同步等待整章 LLM 调用,耗时天然超过代理预算。本地开发直连 localhost
从未暴露该问题。立即处理队列 在大批量下有同样的隐患。

## Decision

把交互式生成迁到 V5 已有的任务队列上,进程内后台执行:

- **任务级覆盖**——`generation_jobs` 新增 `instructions`、`min_chars`、
  `submit_for_review`、`llm_review`(NULL = 沿用书的连载配置;PRAGMA 检查
  的幂等增量迁移,老库原地升级)。`enqueueGenerationJobs(bookId, count,
  opts)` 按批存储。工作台的每个开关都保留——只是改经队列传递而非 HTTP 等待。
- **执行器语义扩展**——终态映射:`!created` → rejected;
  `submitForReview=false` → draft(新);LLM holdNote → held(新);
  submit+autoPublish → published;其余 submitted。
- **`POST /serial/run` mode=background**——kick 处理但不等待,立即返回
  `{started, alreadyRunning, pending}`。worker promise 挂 `globalThis`,
  HMR 多实例与双击折叠为同一 runner;sync 模式保留给脚本。
- **工作台 UX**——生成按钮入队单任务(带开关),kick 后台执行,然后每 3s
  轮询 `/serial/jobs?bookId=`(上限 10 分钟),行流式进任务表,任务到终态后
  渲染结果(落稿/待审核/暂扣/拒绝/失败)。processQueue 以同法轮询至本书无
  活跃任务。

验证:test:ai-serial +5 断言(草稿终态、任务级 minChars 覆盖拒绝而同批兄弟
成功、instructions 存储并执行),test:ai-serial-api 的 background 用例断言
亚秒响应随后 worker 完成;CDP 审计 4/4——点击瞬时返回(按钮翻转 生成中…),
mock 章节 ~3s 后落地并带 待审核 徽章。typecheck 与构建全绿。

## Alternatives considered

**调大代理超时 / 文档化 nginx 配置。**运维侧必要但不是代码修复;任何共享主
机或 serverless 边缘照样掐断。后台模式让响应变瞬时,彻底解除依赖。

**流式补全(SSE)。**保住同步形态但要复杂化 Provider 抽象,且缓冲 SSE 的代
理仍会死;V5 队列已建好,直接复用。

**Serverless 安全 worker(独立队列进程)。**响应后继续执行要求长驻 Node 进
程;自托管 `next start` 没问题,Vercel 类平台需要真 worker。作为已知边界
记录。

## Consequences

收益:生成在任何代理超时策略下都免疫;工作台与连载共用一条执行路径;失败以
任务行呈现而非 HTTP 错误。代价:结果延迟按 3s 轮询量化;Node 进程在执行中途
重启会留下永久 running 的孤儿任务(未来需要 stale 清扫,此规模可接受);UI
轮询 10 分钟封顶,之后任务表本身即事实来源。
