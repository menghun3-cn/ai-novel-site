# Agent Note: AI Writer 引擎

Status: implemented

English | [中文](2026-08-23-ai-writer-engine.md)

## Problem

Story Core 存事实,上下文组装器出提示词,但还没有任何东西与 LLM 对话并把
输出变成受治理的章节。缺口:Provider 管道、在触碰 Content Core 之前的质量
门、以及进入 V3 审核工作流([相关](2026-08-23-review-console-ui.md))而非
直接发布的路径。

## Decision

`core/src/ai-writer.ts`,四块:

1. **Provider 抽象**——`LlmProvider.complete()` 加一个具体适配器
   `createOpenAiCompatibleProvider`(chat-completions 走 fetch,DeepSeek/
   OpenAI/本地网关通吃)。配置经 `resolveProviderFromEnv` 从环境变量
   (`AI_BASE_URL/AI_API_KEY/AI_MODEL`)解析;缺变量抛 `AI_NOT_CONFIGURED`
   (映射 503),上游失败变 `AI_PROVIDER_FAILED`(502)。测试用
   `createFakeProvider` 与本地 http 服务——CI 不碰真网。
2. **规则质检先行**——`qualityCheckChapter()` 是纯函数,三道闸:最短长度
   (默认 500 字)、AI 自述标记(`/作为(一个)?AI|语言模型|…/`)、滑窗重复
   (60 字窗半步滑动,≥4 次相同即拦)。任一闸失败**完全不建章节行**;API
   结果带 `created:false` 与问题码供运营展示。
3. **可选 LLM 复核**——`llmReviewChapter()` 让第二次补全扮演编辑;首行必须
   PASS/FAIL。FAIL 时章节仍以草稿落库,但扣住不自动送审,原因写入章节
   `review_note`,前缀 `LLM 复核暂扣:`——复用 V3 字段,暂扣直接出现在既有
   UI。
4. **经状态机落稿**——成功路径严格是 `createChapter(draft)` 再可选
   `submitChapterForReview`;标题取模型首个 `# ` 一级标题(从正文剥除避免重
   复),回退到大纲标题。目标章冲突从组装器浮出为
   `CHAPTER_NUMBER_CONFLICT`。

端点:`POST /api/admin/ai/generate-chapter`
(`{bookId, chapterNumber?, instructions?, submitForReview?, llmReview?}`),
静态路由显式标注 `withAdmin<AdminRouteContext>`——PR#3 的 Next15 零参泛型
坑又遇一次。

验证:`npm run test:ai-writer`(引擎:质检规则、环境守卫、mock 服务往返、
送审/暂扣/冲突/失败路径)与 `npm run test:ai-api`(端点:未配置 503、校验
400、生成+送审 200、上游 502)。均用临时数据库。

## Alternatives considered

**一步插入为 pending_review。**落选:会绕过 V3 转换守卫,且"存在从未被审
的 draft"这一状态变得不可表达;两步复用已审计代码。

**质检失败自动重试生成。**延后:静默重试翻倍成本且掩盖提示词问题;把
`created:false` 与问题码交给运营者有意调整指令更好。重试属于 V5 流水线,
要配预算。

**硬编码单一厂商 SDK。**落选:OpenAI 兼容形状覆盖本项目可能用的所有后
端;单适配器让依赖面保持为零(纯 fetch)。

## Consequences

收益:带硬性质量底线、默认有人工审核门的章节生产(`submitForReview:false`
只落稿;UI 显式选择送审)。代价:质检启发式粗糙——长度/标记/重复能抓住最
差输出但对情节连贯性无发言权,那仍是 LLM 复核的主观判断;另外生成不加
锁,同书并发生成会在 `MAX(number)+1` 上竞争,输家收到
CHAPTER_NUMBER_CONFLICT——单运营者可接受,V5 需要队列。
