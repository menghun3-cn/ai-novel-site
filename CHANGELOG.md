# 更新日志

本文件记录面向使用者的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循语义化版本。

## [Unreleased]

### V10 内容工厂(P0–P2)

- **新增「产线(Production Line)」一等实体**:一整套「题材/类型模板 + 调度 + 配额 + 质量闸门」配置;一次运行按每个题材的权重分配一批短篇,支持**同一批生成不同题材/类型**(`count >= 题材数` 时每题材至少 1 篇,题材种子池 round-robin 保证同题材也不重样)。
- **`/admin/creation` 重构为「内容工厂」运营指挥中心**:一级 Tab 总览 / 产线 / 队列 / 质量闸门 / 异常分诊 / 成本。
  - 总览:产线健康(今日产出/达标/在制/池/失败/通过率)+ 产出漏斗 + 产线泳道 + 告警 + 最近运行。
  - 产线:创建/编辑(题材清单 weight+种子池、调度、配额、质量闸门)/启停/删除/一键运行。
  - 队列:按类型积压/运行/近 7 日成败 + 执行中任务。
  - 质量闸门:低质量池 + 各产线达标情况。
  - 异常分诊:失败任务/失败创作/低质池/配额超限/规则离线/停用产线,一键重试/优化/启用。
  - 成本:按日/按产线 token 与估算成本、单篇发布成本。
- **新增表**:`production_lines` / `production_runs` / `production_run_items`(产线 → 运行 → 作品,级联删除);使用权属清晰、可聚合。
- **调度器集成**:`fireDueDailyProductionRuns()` 每日到点自动触发,每日产线同日去重。
- **数据闭环**:单篇需求 = 产线基线 ⊕ 题材 brief ⊕ 种子,复用既有「生成 → 评审 → 自动优化 → 再评审 → 达标发布/入池」流水线,无破坏性改动。


## [9.5.0] — 2026-08-26

首个 tag 版本:V9 创作评审中心 + V9.5 阶段二 + 阶段二补丁(M13–M18),全部合入 master(#64/#65/#66/#67/#68)。

### 修复

- **TTS 移动端播放**:首次「朗读」在手势内静音预热解锁并清掉 iOS 卡住的暂停态(WKWebView 点击无声);iOS 改用取消式暂停保留进度;段落按句二次切片、单片字符上限随语速动态钳制,规避安卓 Chrome 超长朗读静音截断;语音列表多重试获取且下拉常显(#67)

### V9.5 阶段二补丁(M13–M18,#66)

- **长篇单章自动优化闭环**:章节评审不合格时自动入队 `AI_OPTIMIZE_CHAPTER`,按评审问题清单改写正文后自动重评,直到达标或达到 `chapter_review_max_rounds` 上限;`chapters.optimize_round` 记录已用轮数
- **调度器单实例互斥锁**:`<数据目录>/scheduler.lock`(O_EXCL + pid 存活检测),第二实例启动即退出,崩溃残留自动接管;`NOVEL_SCHEDULER_LOCK=0` 可跳过
- **TTS 朗读段高亮**:当前朗读段落左侧琥珀色竖条 + 渐变底色(dark 模式适配)
- **评审中心统计补全**:近 7 日章节/弧级评审量双柱趋势、章节维度均分(薄弱维度升序)、弧评汇总
- **章节评审批量入队**:管理端支持多选已发布章节批量入队,逐章校验并返回跳过明细
- **弧评区间模板**:全书 / 上次弧评后 / 最近 5 章一键预填
- **章节评审差异对比**:同章多次评审的分数轨迹、维度首评→最新对比、遗留问题清单

### V9.5 阶段二(M7–M12)

- **短篇发布物化**(M7):`short_story_publications` 表 + `publishShortStory`(passed → Book(kind='short') + Chapter);books 新增长篇评审配置 6 列
- **短篇上线读者站**(M8):公开 API `/api/short-stories`、阅读页 `(site)/short/[id]`、BookCard「短篇」角标
- **长篇章节/弧级评审引擎**(M9):`chapter-review` / `arc-review`;`arc_review_records`;`books.arc_review_every_n`(默认 5)半自动阈值
- **调度器驱动 ai_tasks**(M10):tick 第三块 `processAiTasks({limit:5})`
- **Web Speech API TTS**(M11):零依赖播放器,段落切片、语速/语音偏好持久化
- **文档同步**(M12):README 与 architecture.md 覆盖 V9.5

### 收尾补丁

- 章节发布自动入队评审:`importChapter(published)` 与 `approveChapter(now)` 双路径,去重守卫,失败不阻塞发布
- 评审中心新增「章节评审」「弧级评审」管理 Tab

## [9.0.0] — V9 AI 创作与评审中心(M1–M5)

> 说明:V9 功能随 develop 合入 master 的 squash 提交进入主线(PR #64/#65),未单独打 tag。

- 数据层:short_stories / short_story_versions / review_rules / review_rule_versions / review_prompts / review_records / ai_tasks 七表与状态机
- 引擎:结构化输出容错提取 + 校验 + 自纠重试 ≤2;加权定级服务端计算;全链路留痕
- 自动优化:不合格自动改稿再评审,受规则版本轮数上限约束;低质量池兜底
- 管理 API 18 个路由;/admin/creation 创作中心 + /admin/review-center 评审中心五视图

## [8.1.0] — 2026-08-25

- 平台更名「云燕阅读」(此前为「云雀小说」)
- 连载每日流水线按北京时间调度展示;LLM 网络错误透出根因并加重试
