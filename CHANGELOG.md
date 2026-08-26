# 更新日志

本文件记录面向使用者的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循语义化版本。

## [Unreleased]

### 修复

- **TTS 移动端播放修复**:首次「朗读」在手势内静音预热解锁并 `resume()`+`cancel()` 清掉卡住的暂停态(iOS Safari/WKWebView 点击无声);iOS 改用取消式暂停(原生 pause 后恢复无声,改为 cancel 并保留进度);段落按句二次切片、单片字符上限随语速动态钳制,规避安卓 Chrome 对单条超长朗读的静音截断;语音下拉常显,语音列表经 `voiceschanged`/轮询/回前台/首次朗读手势多次重试获取(iOS 首次朗读后才返回列表),无保存偏好时自动选中首个中文语音

### V9.5 阶段二补丁(feat/v9.5-tailing)

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

## [8.1.0] — 2026-08-25

- 平台更名「云燕阅读」(此前为「云雀小说」)
- 连载每日流水线按北京时间调度展示;LLM 网络错误透出根因并加重试

## [9.0.0] — V9 AI 创作与评审中心(M1–M5)

> 说明:V9 功能随 develop 合入 master 的 squash 提交进入主线(PR #64/#65),未单独打 tag。

- 数据层:short_stories / short_story_versions / review_rules / review_rule_versions / review_prompts / review_records / ai_tasks 七表与状态机
- 引擎:结构化输出容错提取 + 校验 + 自纠重试 ≤2;加权定级服务端计算;全链路留痕
- 自动优化:不合格自动改稿再评审,受规则版本轮数上限约束;低质量池兜底
- 管理 API 18 个路由;/admin/creation 创作中心 + /admin/review-center 评审中心五视图
