# Agent Note: 生成上下文组装器

Status: implemented

English | [中文](2026-08-23-story-context-assembler.md)

## Problem

路线图的核心洞见([§7](../../../docs/AI原创内容创作平台.md)):裸的"AI 写第
50 章"会漂移——人设走形、世界观冲突、伏笔遗忘。AI 写作者必须先*看到*世界
观、人物状态、活跃故事线、未回收伏笔、最近章节与目标章大纲。仓库里没有任
何东西组装这个视图。

## Decision

`core/src/story-context.ts` 提供两个纯读函数:

- `getGenerationContext(bookId, opts)` 返回 `GenerationContext`:世界观、
  人物(+当前状态)、关系、**非 done** 故事线、**仅未回收**伏笔、近章摘录
  (默认尾部截断 600 字,旧→新)、`nextChapterNumber`(默认 `MAX(number)+1`,
  可显式指定)、该号的大纲行(如有)。守卫:书不存在 → `BOOK_NOT_FOUND`;
  显式指定的章已存在 → `CHAPTER_NUMBER_CONFLICT`——生成只面向"下一章"或
  预留大纲位,绝不覆盖已有正文。
- `renderGenerationPrompt(ctx)` 渲染确定性 Markdown 提示词,分节顺序固定
  (`# 任务 / 世界观与写作规则 / 人物 / 人物关系 / 故事线 / 未回收伏笔 /
  最近章节 / 第 N 章大纲`);空节跳过。有大纲时提示"要点必须全覆盖",无大纲
  时指示自然续写。测试断言逐字节确定性,提示词回归可 diff。

摘录只取每章尾部:结尾承载连续性(向前钩子),且无论章节多长 token 成本有
界。验证在 `scripts/verify-story-context.ts`(`npm run test:story-context`,
24 项断言):空书默认值、章号推导、冲突守卫、done/open 过滤、截断长度、渲
染确定性。

## Alternatives considered

**组装时用 LLM 总结旧章。**延后:摘要会让提示词非确定,且每次生成都为稳定
事实重复付出延迟;尾部摘录免费且稳定。缓存摘要层以后可以插入而不改
`GenerationContext`。

**把组装放进将来的 AI-writer 模块。**落选:分离让 PR#15 的引擎只管
Provider/提示词机制;管理端 UI 或调试端点也能在不调 LLM 的前提下看到模型
将看到的东西。

**收录全部伏笔并标注已回收。**落选:已回收项对下一章任务是噪音;
`openOnly` 在 PR#13 已经建好。

## Consequences

收益:Story Core 事实与任何消费者之间有一条经过测试的接缝;PR#15 把
`renderGenerationPrompt` 输出直接喂给 Provider 适配器。代价:尾部摘录看不
到章节中段对老设定的呼应——长程连贯仍依赖维护好大纲/伏笔记录;另外
`nextChapterNumber` 统计任意状态的章节,下一号被草稿占用时必须先清掉才能
重新生成(有意为之:以 CHAPTER_NUMBER_CONFLICT 浮出,而不是静默重复)。
