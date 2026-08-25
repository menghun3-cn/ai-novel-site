# Agent Note: Story 工作台 UI

Status: implemented

English | [中文](2026-08-23-story-workbench-ui.md)

## Problem

V4 的数据层、上下文组装器与 AI Writer 只有 API:不用 curl 就看不到世界观、
人物、故事线、大纲、伏笔,生成要手拼 HTTP 请求。闭环只存在于终端里。

## Decision

单页 `/admin/story`(**AI 创作中心**,侧栏新增 Sparkles 图标入口):顶部
选书,下方堆叠卡片——世界观与写作规则(双 Textarea + 保存)、人物(表格 +
定位徽章 + 新建/编辑弹窗 + 删除确认)、人物关系(内联添加行)、故事线(状态
徽章 + 弹窗)、章节大纲(按章号 upsert 弹窗,要点每行一条)、伏笔(埋设弹窗 /
回收弹窗复用 COALESCE 幂等语义 / 删除)、以及 AI 工作台卡。

工作台显示目标章号(`MAX(number)+1`,与引擎默认一致)、可选指令框、两个开关
——质检通过后自动送审(默认开)与 LLM 编辑复核(默认关)——并精确渲染结果:
成功 → 章号/标题/字数加 送审/暂扣/草稿 处置;质检拦截 → `created:false`
并列出问题码,不写任何数据。成功后派发 `admin:review-changed`,审核角标即
时更新。

后端收敛为 `/api/admin/books/[id]/story/*` 七个路由(bundle GET、world
PUT、characters POST/DELETE 且支持 characterId 定点改名、relationships、
arcs POST/PUT/DELETE、outlines 按章号 PUT/DELETE、foreshadowing POST/
PUT 回收/DELETE)。全部直用 core 服务;错误码经既有穷举 STATUS_BY_CODE 映射。

验证沿用 CDP 协议,对接 **mock LLM 上游**(本地 http 服务讲 chat-completions,
经 `AI_BASE_URL/AI_API_KEY/AI_MODEL` 接线):20 项断言覆盖导航入口、表单回
填、各表格/徽章、目标章号、真实点击 生成 → 落稿 → 自动送审 → 角标递增、
添加人物弹窗往返、删除确认取消路径、375px 抽屉化与零溢出。typecheck 与生
产构建全绿。审计迭代了一轮:React 受控输入在 CDP 脚本里必须走原生 value
setter。

## Alternatives considered

**塞进既有书籍详情页做标签页。**落选:故事事实属于另一条工作流(创作设定
vs 发布运营);合并会让本就密集的详情页对两边都更难用。

**每个实体独立页面**(人物页/大纲页…)。落选:搭设定是一个连续任务,操作对
象是小而相关的集合;典型规模(<20 行/实体)下每本书六次跳转不可接受。

**变更用乐观 UI。**再次拒绝:每次变更后经 API 重载让表格与服务端真值恒
等;SQLite 下延迟无感。

## Consequences

收益:V4 全链路——定义世界/人物/情节 → 带护栏生成 → 落入 V3 审核队列——
全程浏览器可操作。代价:刷新后书籍选择不保留(URL 尚未带选中参数);工作台
目标章号是客户端 MAX+1 展示值,服务端会权威重算,旧标签页可能显示过期目
标直到下次加载;两者若真造成困扰都是廉价后续。
