# AI 小说创作与自动评审中心 · 持续创作产线方案

> 版本:V10.5 已实现(feat/continuous-production-line,M1–M4 全部落地,含 verify 与 UI)
> 决策:扩展现有 V10 产线(`production-line.ts`)为 `continuous` 调度模式。
> 默认参数(已确认):每轮 `count=3`、熔断阈值 `maxConsecutiveFailures=3`;**不设触发间隔**,
> 由背压驱动无间隙生产(实际触发粒度 = 调度器 tick,默认 60s,可调小至 5s)。

---

## 1. 背景与目标

在短篇小说创作中,开启一个**持续创作到发布**的任务:任务启动后不断生成短篇小说并自动发布,
使平台短篇篇数持续增长。创作内容可**随机**或**指定分类/主题/内容**,默认为随机。
停止门禁只有两种:① 人工停止;② 连续错误达到阈值自动熔断。
核心目标:**持续创作,永不停止**(除非触发上述门禁)。

---

## 2. 现状盘点(提案 80% 零件已存在)

| 提案诉求 | 现有能力 | 差距 |
|---|---|---|
| 一次产出多篇短篇 | `runProductionLine`:按 kinds 权重分配 count 篇,逐篇建短篇并入队创作流水线 | ✅ 已有 |
| 指定分类/主题/内容 | `ProductionLineConfig.kinds[].brief/seeds` + 产线级 `brief` | ✅ 已有 |
| 达标自动发布 | `qualityGate.publishOnPass=true` → `publishShortStory` 物化为 Book+Chapter | ✅ 已有(默认 true) |
| 创作循环(生成→评审→优化→发布/入池) | `short-story-pipeline.ts` 全闭环 + `ai_tasks` 账本 | ✅ 已有 |
| 定时触发 | `schedule.mode='daily'` + 调度器 `fireDueDailyProductionRuns` | ⚠️ 仅"每日一次",无持续循环 |
| 停止门禁 | 仅 `enabled=false` 手动停用 | ❌ 无错误熔断 |
| 随机题材 | kinds 需显式配置 | ❌ 无内置随机题材池 |

**结论:不新建实体,扩展产线调度模式 + 熔断字段 + 随机题材池即可实现持续创作。**

---

## 3. 总体设计

### 3.1 调度模式扩展:新增 `continuous`

```ts
export type ProductionLineScheduleMode = 'manual' | 'daily' | 'continuous';

export interface ProductionLineSchedule {
  mode: ProductionLineScheduleMode;
  hour?: number;                // daily 用
  count: number;                // 每轮篇数(持续模式 1..10)
  // 持续模式不设时间间隔:无间隙生产由背压驱动(见 3.2),
  // 实际触发粒度 = 调度器 tick(PUBLISH_TICK_SECONDS,默认 60s,下限 5s)。
}
```

- `normalizeLineConfig` 校验:`continuous` 模式**不接受** `intervalSeconds`(持续生产由背压驱动,
  不设冷却时间——人为间隔会制造生产间隙,与"无间隙"目标矛盾)。
- `continuous` 模式**不适用** daily 的"同日去重"(`lastRunDate === today` 拒绝),
  由背压判定 + 调度器 tick 驱动(见 3.2)。

### 3.2 调度语义:背压驱动的无间隙生产

**关键事实**:单篇短篇流水线(生成 maxTokens≈8000 + 自动评审 + 可能优化轮)耗时远大于一个
调度 tick,持续模式**不设时间间隔**——真实生产节奏完全由**任务消费速度(背压)**决定:

```
触发条件(全部满足才 fire,每个调度 tick 检查一次):
  1. line.enabled = 1
  2. 未熔断(consecutive_failures < max_consecutive_failures)
  3. 背压允许:该产线"在飞"短篇数 < 背压阈值
```

**背压规则**(防 ai_tasks 队列无限膨胀):

```
inFlight(lineId) = COUNT(short_stories s
  JOIN production_run_items ri ON ri.story_id = s.id
  JOIN production_runs r ON r.id = ri.run_id
  WHERE r.line_id = :lineId
    AND s.status IN ('draft','generating','reviewing','optimizing','scheduled'))
  + COUNT(production_runs WHERE line_id=:lineId AND status='executing')

背压阈值 = max(2, schedule.count * 2)   // 默认 count=3 → 阈值 6
```

> 注:`draft` 必须计入在飞——`createShortStory` 创建后即入队但状态仍为 draft(直到 worker
> 执行才转 generating),若不统计,worker 消费前会无限触发新轮次导致队列堆积。

- `inFlight >= 阈值` → 本轮跳过,下个 tick 再试(不报错、不计数失败)。
- `inFlight < 阈值` → `runProductionLine(lineId, { trigger:'continuous' })`。
- 效果:任务启动后**无缝连续生产**——上一批消化得差不多,下一批立即开跑;LLM 慢则自然降速,
  不产生堆积,真正"永不停止"。

### 3.3 停止门禁(人工停止 OR 错误次数)

在 `production_lines` 增加熔断字段:

```sql
ALTER TABLE production_lines ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE production_lines ADD COLUMN max_consecutive_failures INTEGER NOT NULL DEFAULT 3;
ALTER TABLE production_lines ADD COLUMN tripped_reason TEXT;   -- 熔断原因
ALTER TABLE production_lines ADD COLUMN tripped_at TEXT;       -- 熔断时间(ISO)
```

**错误计数以"轮"为单位**:

- 一轮 `runProductionLine` 抛错(run 落 `status='failed'`、`error` 留痕)→ `consecutive_failures++`。
- 成功一轮(含背压跳过)→ 不清零,但**完整成功一轮**才清零(背压跳过属于"未触发",不动计数)。
- 单篇短篇 `failed` **不**计入熔断(短篇流水线本身可重试,避免误伤);
  但一轮内创建的多篇短篇全部 `failed` 视为该轮失败(可选增强,见 §8)。

**熔断动作**:

- `consecutive_failures >= max_consecutive_failures` → `enabled=0` + 写 `tripped_reason`/`tripped_at`,
  调度器不再触发;错误细节保留在 `production_runs.error` 与 `ai_tasks`,可审计。
- **人工恢复**:admin 调用恢复接口 → `enabled=1` + `consecutive_failures=0` + 清 `tripped_*`。

**人工停止**:沿用 `enabled=false`(前端"暂停/恢复"按钮),暂停不动任何计数,恢复即续跑。

### 3.4 随机题材池(默认随机)

- **内置 `DEFAULT_KINDS`**:8–12 个常用题材(都市言情/悬疑/科幻/奇幻/古风/现实/推理/冒险/青春/职场…),
  每个题材带 2–3 个种子主题(theme/synopsis/coreConflict 等)。
  用户未配置 `kinds` 时启用内置池 → **默认即随机**。
- **每轮随机化**:continuous 模式每轮触发前对题材做 **shuffle / 权重抖动**,
  避免每轮产出同一批题材;仍走 `assignRunKinds` 的权重分配与种子 round-robin。
- **指定模式**:用户显式配置 `kinds` + `brief`(现有 UI 已支持)→ 优先用配置,不配置则用内置池。
- 标题与主角名由 LLM 生成,`buildCreationPrompt` 已要求主角名原创不重复,多篇天然不同味。

### 3.5 护栏与观测

- **配额保留生效**:`quota.dailyLimit`(每日篇数软上限)与 `quota.dailyBudgetUsd`(每日成本预算)
  对 continuous 同样生效;建议持续模式默认 `skipOnBudgetOverrun=true`(预算超支自动跳过当轮)。
- **未配置预算的强提示**:无 `dailyLimit`/`dailyBudgetUsd` 时,前端开启持续任务需二次确认
  ("未设每日上限,将按消费速度无限生成,可能产生持续费用")。
- **质量门槛**:持续模式建议 `qualityGate.minScore` 不低于全局默认,防止低质内容海量入读者站。
- **观测(production-ops 聚合页)**:持续任务卡片展示
  运行中/已暂停/已熔断、`consecutive_failures`、熔断原因与时间、
  累计发布篇数(`short_story_publications` 按 book→line 归属统计)、今日已产篇数、成本估算。
- **单实例**:持续任务只由调度器驱动(web worker 不碰),复用现有 `scheduler.lock` 防双跑;
  调度器重启后自动续跑(背压判定天然兼容停机恢复)。

---

## 4. 数据模型变更汇总

| 变更 | 说明 |
|---|---|
| `production_lines` +4 列 | `consecutive_failures`、`max_consecutive_failures`、`tripped_reason`、`tripped_at`(列迁移,幂等) |
| `production_lines.config_json.schedule` | 增加 `mode='continuous'`(复用已有 count;不设间隔字段) |
| 无新表 | runs/items/ai_tasks/short_story_publications 全部复用 |

---

## 5. 调度器接入(`scripts/publish-scheduler.ts`)

在 `tick()` 中新增一块(建议置于 `fireDueDailyProductionRuns` 之后):

```
5) fireDueContinuousProductionRuns({ onRun })
```

核心服务函数(放 `production-line.ts`):

```ts
export function listDueContinuousProductionLines(): ProductionLine[];
// 过滤:enabled=1、mode='continuous'、未熔断、背压允许(每个 tick 检查一次)

export function fireDueContinuousProductionRuns(
  opts?: { onRun?: (r: ProductionRun) => void }
): string[];   // 返回触发的 run id;成功一轮清零连续失败,失败 bump,达阈值自动熔断;单线失败不阻断其他线

export function resumeProductionLine(lineId: string): ProductionLine;  // 人工恢复:enabled=1 + 清零 + 清 tripped

export function isLineTripped(line: ProductionLine): boolean;          // 熔断态判定(前端徽标用)

export function countInFlightForLine(lineId: string): number;          // 在飞短篇数(背压 + 观测)

export function backpressureThreshold(config: ProductionLineConfig): number; // max(2, count*2)
```

熔断读写辅助:`bumpConsecutiveFailures(lineId, reason)` / `resetConsecutiveFailures(lineId)`
(内部函数;对外暴露 `resumeProductionLine` / `isLineTripped`)。

---

## 6. 前端与运营(创作中心 + production-ops)

- 创作中心产线配置表单:`schedule.mode` 增加 `continuous` 选项(无间隔参数,展示背压阈值说明),
  仍可配置熔断阈值 `max_consecutive_failures`;未配预算时弹二次确认。
- 产线列表/详情:持续任务显示运行态徽标(生产中/已暂停/已熔断 + 熔断原因),
  "暂停/恢复"按钮调 admin API(复用 `setProductionLineEnabled` + 新增 `resumeProductionLine`)。
- production-ops 聚合页:持续任务状态卡(见 §3.5)。

---

## 7. 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1 core + 调度** | 类型扩展(continuous + 熔断列)、`normalizeLineConfig` 校验、`listDueContinuousProductionLines` / `fireDueContinuousProductionRuns`(背压+熔断)、调度器 tick 接入 | ✅ `verify-continuous-production-line.ts` 全绿 |
| **M2 随机** | `DEFAULT_KINDS` 内置池(10 题材 × 3 种子) + 每轮 shuffle/权重抖动;未配 kinds 时注入,指定配置优先 | ✅ verify 覆盖 |
| **M3 门禁与 UI** | 暂停/恢复/重置熔断 API(`resume` 路由)+ 创作中心持续模式表单与状态徽标 + 未配预算二次确认 | ✅ 熔断→恢复流程 verify;typecheck 通过 |
| **M4 观测** | production-ops 总览"持续创作"状态卡(在飞/阈值/熔断)+ 熔断告警 + 异常分诊恢复动作 + 带概览 inFlight | ✅ verify 覆盖 + build:web 通过 |

---

## 8. 风险与边界(待后续决策)

1. **成本**:持续生产 + 无配额 = 无限费用(实际节奏由调度器 tick 与消费速度决定);
   依赖 `dailyLimit`/`dailyBudgetUsd` + UI 强提示。
2. **同质化**:种子池 + shuffle 仅缓解;标题/梗概级防重复(查重)列为增强项。
3. **数据膨胀**:每篇 = 1 短篇 + 多版本 + 1 Book/1 Chapter;可加"发布后仅保留最新版本"清理策略。
4. **任务背压**:`processAiTasks({limit:5})` 每 tick 消费 5 个,持续模式下生成速度可能超过消费速度;
   已由背压规则兜底,必要时调大 limit 或减小每轮 count。
5. **"一轮内多篇全 failed 计一轮失败"**:当前按轮级抛错计数;篇级全败视同轮败为可选增强,
   可避免"每轮都建篇但篇篇失败"时熔断失灵。建议 M3 一并评估。

---

## 9. 决策记录(本次已确认)

| # | 决策 | 结论 |
|---|---|---|
| D1 | 实现路径 | 扩展 V10 产线为 `continuous` 模式,不新建实体 |
| D2 | 本轮范围 | 只定方案,不写代码;按 M1–M4 后续落地 |
| D3 | 默认每轮篇数 | `count=3` |
| D4 | 触发间隔 | **不设间隔**:无间隙生产由背压驱动;实际触发粒度 = 调度器 tick(默认 60s,可调至 5s) |
| D5 | 默认熔断阈值 | `maxConsecutiveFailures=3` |
| D6 | 错误计数单位 | 轮级抛错;单篇 failed 不熔断(篇级全败视同轮败列为增强) |
| D7 | 随机默认 | 未配 kinds 时启用内置 `DEFAULT_KINDS`,每轮 shuffle |
| D8 | 停止门禁 | 人工暂停(`enabled=false`)+ 连续错误熔断自动停线,人工恢复清零 |
