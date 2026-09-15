# Agent Note: Edge 端点默认切换为自定义域名,移除本地 Kokoro 引擎

Status: implemented

[English](2026-09-15-edge-tts-custom-domain-kokoro-removal.md) | 中文

## Problem

V10.7.7 把 `edge` 引擎切换到 ai-edge-tts2api 的 OpenAI 兼容封装(见
[edge-tts-openai-compatible-api](../../implemented/feature/2026-09-15-edge-tts-openai-compatible-api.zh.md))
之后,遗留两个问题:

1. **封装默认端点从生产环境不可达。** ai-edge-tts2api README 的端点是
   `*.workers.dev` 主机;在生产主机(境内,hcss-ecs-8245)上
   `edgetts2api.edgetts.workers.dev` 被 DNS 污染:解析到被劫持的
   `31.13.96.192`、查询 SERVFAIL、TCP 443 不通——上游说明这是网络属性
   ("not a service fault"),但文档默认值无法服务本部署。自定义域名
   `https://edgetts2api.menghun3.cc` 从工作区与生产主机均可直连(同一共享
   密钥),是开箱即用的可行默认值。
2. **本地 Kokoro 引擎在这台主机上过度建设。** V10.7 引入的离线 / 默认听书
   引擎(见已归档的
   [local-kokoro-tts](../../archived/feature/2026-09-03-local-kokoro-tts.zh.md)
   笔记)需要约 80 MB q8 模型权重 + onnxruntime 内存,在 2 核 / 1.8 GiB
   主机上内存压力下合成极慢(20 字 ≈7 s;100 字换页时 176~338 s)。为维持
   可用,整个链路被拉进运维面:Dockerfile 条件构建参数、compose 模型卷、
   webpack `createRequire` 绕行、合成串行化队列、容器内 TTS 自检。用户要求
   把 edge 指向自定义域名,**并整条移除 kokoro 引擎**。

## Decision

- **Edge 默认端点 = 自定义域名。** `EDGE_TTS_API_URL` 缺省为
  `https://edgetts2api.menghun3.cc/v1/audio/speech`(环境变量覆盖不变);
  共享 `EDGE_TTS_API_KEY` 缺省不变。已从生产主机用共享密钥实测:
  `GET /v1/models` → 200;`POST /v1/audio/speech` → 200,返回 20,736 字节
  `audio/mpeg`(MPEG ADTS L3,48 kbps,24 kHz 单声道)。`*.workers.dev`
  仍作为境内的已知网络限制(DNS 污染)记录在文档,不再是代码路径。
- **kokoro 引擎全线移除:**
  - `web/app/api/tts/route.ts`:引擎恰好为 `edge` | `native`;
    `GET /api/tts` 返回 `{"engines":["edge","native"]}`——无 kokoro 探测、
    无 `503` 分支。
  - `web/components/TtsPlayer.tsx`:kokoro 引擎选项、语音列表、可用性探测
    与已存引擎回退全部移除;老客户端 `KEY_ENGINE='kokoro'` 静默回退默认
    `edge`。引擎下拉:「✨ AI 情感听书」(edge)+「系统语音」(native)。
  - 删除文件:`web/lib/kokoro.ts`、`web/lib/kokoro-server.ts`、
    `scripts/fetch-kokoro-voices.mjs`、`scripts/verify-tts-local.ts`。
  - `Dockerfile`:`ENABLE_LOCAL_TTS` / `KOKORO_HF_ENDPOINT` 参数、条件安装
    `kokoro-js-zh` + `onnxruntime-node`、语音预下载步骤全部移除;deps 阶段
    恢复为普通 `npm install --prefer-offline`。
  - `docker-compose.yml`:`./models/kokoro` 卷、`KOKORO_MODEL_DIR` 环境变量
    与构建参数注释移除;`next.config.ts` 的 `serverExternalPackages` 恢复为
    `['better-sqlite3']`。
  - `./rebuild.sh`:仅保留 `--clean`(`--tts` / `--model` / `--no-tts` /
    `--no-model` 与模型下载步骤移除);不再在容器内跑 `test:tts-local`。
  - `test:*` 脚本 44 → 43;四个 `package.json` 版本 8.3.9 → **8.4.0**
    (V10.8.0——功能移除为次版本号递增)。
- **撤销 V10.7 的说法。** "kokoro 保持默认听书引擎"(V10.7.7 笔记与 i18n)
  更正为:默认引擎为 `edge`,引擎为 `edge` + `native`。当初促成 kokoro 的
  移动端 502 根因(运营商 / CF 中间层对长时 edge POST 超时,见
  [user-categories-and-list-performance](../../implemented/feature/2026-09-04-user-categories-and-list-performance.zh.md))
  仍作为历史记录保留;自定义域名恢复了服务端可达性,前端继续切片请求。

## Alternatives considered

**保留 kokoro 但降级为可选(edge 默认)。** 否决:用户明确要求移除;onnxruntime
链路(条件依赖、构建参数、模型卷、串行化队列、webpack 绕行)会继续付出
维护与内存成本,而它在这台主机上慢到不可用。自定义域名切换已经解决了当初
让 kokoro 显得必要的服务端可达性问题。

**保留 `*.workers.dev` 默认,靠部署时 `EDGE_TTS_API_URL` 覆盖。** 否决:
文档上写着但实际不可达的默认值是陷阱——生产主机完全连不上它,每次部署
都隐式依赖覆盖;本仓库的发布流程要求默认值在境内开箱即用。

**保留 kokoro 直到有离线替代。** 否决:当前部署已无离线需求(设备端
`native` Web Speech 覆盖离线场景);精确的重引入条件与 V10.7 完整机制
均可从归档笔记中恢复。

## Consequences

- 听书引擎恰好为 `edge`(默认)+ `native`;无 kokoro 探测、无 `503` 路径、
  UI 无「本地语音」选项。
- 镜像不再安装 / 下载约 80 MB 模型权重与 onnxruntime:镜像更小、构建更快。
  主机上的 `./models/kokoro/` 成为孤儿目录(不再挂载,可手工删除)。
- edge 合成依赖运行时主机对 `https://edgetts2api.menghun3.cc` 的出站 HTTPS;
  已从生产主机实测(上述 200)。30 秒路由超时与共享密钥缺省不变。
- 笔记:[local-kokoro-tts](../../archived/feature/2026-09-03-local-kokoro-tts.zh.md)
  特性笔记与三篇 kokoro 修复笔记(构建参数修复、合成串行化、
  webpack createRequire stub)归档(冻结);
  [lowmem-kokoro-tuning](../../implemented/bug-fix/2026-09-04-lowmem-kokoro-tuning.zh.md)
  保持活跃并就地更新事实(其 `NODE_OPTIONS` / `mem_limit` 仍是 compose
  活跃配置,作为通用主机护栏);
  [edge-tts-openai-compatible-api](../../implemented/feature/2026-09-15-edge-tts-openai-compatible-api.zh.md)
  与
  [user-categories-and-list-performance](../../implemented/feature/2026-09-04-user-categories-and-list-performance.zh.md)
  就地更新(端点默认、引擎列表)。
- 验证:`npm run typecheck`、`build:web`、`test:tts-reader` 全绿;自定义域名
  端点已从生产主机实测;路由在沙箱内对真实端点做了端到端验证。
