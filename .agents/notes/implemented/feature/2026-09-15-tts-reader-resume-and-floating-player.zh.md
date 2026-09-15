# Agent Note: 听书读屏容错——悬浮播放条 + 合成中断自动重试/断点续播

Status: implemented

[English](2026-09-15-tts-reader-resume-and-floating-player.md) | 中文

## Problem

V10.8 引擎收敛(仅 `edge` + `native`,见
[edge-tts-custom-domain-kokoro-removal](../../implemented/simplification/2026-09-15-edge-tts-custom-domain-kokoro-removal.zh.md))后,
听书暴露两个痛点:

1. **控件随滚动离开视口。** 完整控制面板(`web/components/TtsPlayer.tsx`)位于正文
   上方。播放时页面自动下滚跟随高亮段落(对当前段 `scrollIntoView`),几段之后面板
   就滚出视口——暂停/停止必须先拉回页面顶部。
2. **合成中断即致命且不可恢复。** 任何失败——5xx/断网/20 秒超时/**HTTP 200 但音频
   为空或截断**(上游流在合成中途被切断)或损坏 blob 触发的 `audio.onerror` /
   `audio.play()` 拒绝——都会走完整 `stop()` 路径,清空 `edgeQueueRef`、
   `edgeIdxRef` 与预取缓冲。唯一恢复方式是重头播放整章;而且只有仍在进行的
   `fetchEdgeAudio` 会重试(仅 5xx/网络),损坏音频的播放失败从不重试。

## Decision

`web/components/TtsPlayer.tsx` 新增**悬浮 mini 播放条**与**保留断点的中断模型**,
退避助手放在 `web/lib/tts.ts`(纯函数):

- **悬浮 mini 播放条(底部胶囊)。** 用 scroll/rAF 监听顶部控制面板是否滚出视口
  (`panelOutOfView`)。会话进行中(`isPlaying || paused || interrupted || edgeBusy`)
  且面板不可见时,底部居中渲染固定胶囊:播放/暂停、停止、实时状态(正在听书
  第 x/y 段 / 正在合成 / 自动重试中 / 已暂停 / 播放中断可续播)。点胶囊主体平滑
  滚回面板,并补偿 sticky 站头高度(`HEADER_OFFSET = 104`);通过内联
  `padding-bottom: max(0.75rem, env(safe-area-inset-bottom))` 尊重安全区。
- **播放层自动重试。** `playEdgeChunk` 把「取音频 + 播放」包进重试循环
  (最多 `EDGE_AUTO_RETRY = 2` 次),指数退避
  (`edgeRetryDelayMs(n) = 1200 × 2^(n−1)`,`verify-tts-reader` 已测)。覆盖合成失败、
  **`fetchEdgeAudio` 把空音频视为可重试的瞬时失败**、损坏音频的 `audio.onerror`,
  以及 `audio.play()` 拒绝。`NotAllowedError`(自动播放策略)仍立即进入中断态并给出
  可操作提示——自动重试解决不了缺失的用户手势。重试进度可见
  (「合成中断,正在自动重试(第 n/2 次)…」);退避等待在用户暂停/停止时中止
  (`edgeActiveRef` 置 false)。
- **保留断点,而非整停。** 重试耗尽后进入 `interrupted` 态:队列、当前片下标、预取
  缓冲**都保留**(`suspendSession` 只停掉当前音频并清 busy 指示)。「继续」/「重试」
  (`play`)从 `playEdgeChunk(edgeIdxRef.current)` 当前片续播;系统语音引擎出错时保留
  `unitsRef`/`idxRef`,从 `idxRef` 恢复。只有显式「停止」才真正重置。退避等待期间
  暂停会放弃本次重试,之后再继续则重新合成当前片。
- 面板的「重试」按钮与按钮文案感知新状态(`paused || interrupted` → 继续)。

## Alternatives considered

- **完整控制面板吸顶。** 否决:面板高 2–3 行(引擎/语音/语速/状态),移动端会遮挡
  阅读高度;且站头本身已 `sticky top-0 z-20`,双吸顶叠层打架。会话期间才出现的
  紧凑悬浮胶囊规避了这两个问题,也符合主流听书交互(微信读书/番茄小说/音乐 App
  mini-player)。
- **单个悬浮圆形按钮(FAB)。** 否决:信息量不足,看不到状态,还要多一步才能触达
  「停止」;胶囊一个控件就带上播放/暂停 + 停止 + 状态。
- **快速失败,保留错误,要求手动点「重试」(维持现状)。** 否决:用户明确反馈"中断
  没有自动重试"让功能显得坏掉;瞬时的上游波动不应要求手动点击。有界退避 + 可见
  进度的自动重试是折中方案。
- **记录段落下标后重跑 `startEdge` 续播。** 否决:重新切片、重拉会丢掉句级片的
  连续性;保留 `edgeQueueRef`/`edgeIdxRef` 可以从精确的片续播并复用预取缓冲。

## Consequences

- 会话进行中且面板不可见时,底部胶囊悬浮于视口;面板滚回视口或会话结束即消失
  (停止隐藏;从不滚动的短篇不会出现)。
- 失败现在最多消耗约 3.6 秒退避加上 `fetchEdgeAudio` 内部重试才浮出结果;
  「可续播」态的极端时延比快速失败更长,因此状态行明确显示「正在自动重试」以免
  误导。
- `interrupted` 会被任一路径的继续、停止与引擎切换清除;刻意的暂停不会被在途重试
  覆盖(暂停通过 `edgeActiveRef` 终止退避等待)。
- 片中暂停→继续仍从音频元素的 `currentTime` 续播(元素在暂停后存活时);若暂停
  落在退避等待间隙(尚无元素),继续会重新合成并重读当前句片——绝不会重读整章。
- 错误提示改指向「继续」作为恢复动作。
- 验证:`npm run typecheck -w web` 全绿;`npm run test:tts-reader` 16/16(新增两条
  断言钉死退避节奏)。跨文件改动只有共享绑定与状态(`web/lib/tts.ts` 助手);引擎
  契约、API 形态、存储格式均未变,未取代任何既有 Agent Note。
