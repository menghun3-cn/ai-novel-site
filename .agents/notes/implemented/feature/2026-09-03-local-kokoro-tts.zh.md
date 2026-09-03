# Agent Note: 本地 Kokoro 中文 TTS,与 Edge 并列的听书引擎

Status: implemented

English | [中文](2026-09-03-local-kokoro-tts.md)

## Problem

听书功能原有 `native`(Web Speech API)与 `edge`(经 `/api/tts` 代理的在线 Edge
TTS 合成)两种引擎:Edge 依赖微软在线服务,离线不可用。本地化的自然候选
`kokoro-js` npm 包**只带英文语音**(28 个 `af_*`/`am_*`/`bf_*`/`bm_*` 硬编码在
包里),无法产出中文,其中文音素化路径也不可用。需求是:完全离线的中文语音引擎,
不可用时自动回退 Edge。

## Decision

新增第三引擎 `kokoro`(本地语音),基于 **`kokoro-js-zh` 2.1.7** —— kokoro-js 的
中文 fork,其 `VOICES` 含 8 个中文语音(`zf_xiaobei`/`zf_xiaoni`/`zf_xiaoxiao`/
`zf_xiaoyi` 女声,`zm_yunjian`/`zm_yunxi`/`zm_yunxia`/`zm_yunyang` 男声),音素化
走 espeak-ng 的 `zh-CN`。模型为 `onnx-community/Kokoro-82M-v1.0-ONNX`(q8 量化,
约 80 MB),其 `voices/` 目录存放匹配的 `.bin` 语音嵌入。

关键机制:

- **条件构建。** `Dockerfile` 新增 `ARG ENABLE_LOCAL_TTS=0`;置 1 时 deps 阶段
  额外安装 `kokoro-js-zh` + `onnxruntime-node`(`--no-save`,不动
  package.json/lock,`=0` 镜像体积不变),把 `espeak-ng` 依赖包里的
  `espeak-ng.wasm` 复制进 `kokoro-js-zh/dist/`(原包漏发,不复制中文 G2P 直接
  Abort),并预下载 8 个语音 `.bin`(Node 端构建离线可用;构建时跳过则运行时补齐)。
- **运行时探测 + Edge 回退。** `web/lib/kokoro-server.ts` 的
  `kokoroAvailable()` 仅在依赖已装 **且** `KOKORO_MODEL_DIR`(docker 卷挂载,
  须含 `.onnx`)存在或缓存目录可写(在线下载)时为真。`/api/tts` 在
  `engine=kokoro` 不可用时返回 `503`,前端回退 `edge`;`GET /api/tts` 探测可用性,
  `TtsPlayer` 只在真正可用时展示 🎧 本地语音 选项。
- **资产自愈。** `ensureRuntimeAssets()` 首次加载前补齐 `espeak-ng.wasm` 与
  8 个 `voices/*.bin` —— 二者是 kokoro-js-zh Node 端写死的路径,无法配置。
- **hf-mirror 默认。** transformers.js 3.x 不读 `HF_ENDPOINT` 环境变量,代码内
  设置 `env.remoteHost`,默认 `https://hf-mirror.com`(国内可直连;
  `KOKORO_HF_ENDPOINT` 可切海外官方源)。模型下载缓存到 `/app/data/.kokoro-cache`。
- **白名单门禁。** 仅暴露 8 个中文语音(`web/lib/kokoro.ts`);按产品硬性要求
  不要英文语音,英文语音刻意排除。

## Alternatives considered

**沿用原版 `kokoro-js` 1.2.1。** 实测否决:其语音白名单硬编码 28 个英文语音,
`list_voices()` 无返回值;Node 端语音加载只读包内 `../voices/*.bin`;
`phonemizer` 1.2.1 对 `cmn`/`zh` 报 "Invalid language identifier"。完全无法
合成中文 —— 不满足硬性需求。

**用 `onnx-community/Kokoro-82M-v1.1-zh-ONNX`。** 其 `voices/` 是编号文件
(`zf_001.bin`…),与 kokoro-js-zh 的命名语音查找不匹配;fork 自己的 README 也是
用 `zf_*` 语音配 v1.0-ONNX 模型。实测 v1.0-ONNX 可用 —— 选定。

**只在镜像内置语音文件。** 离线构建仍可行:Docker `RUN` 块预下载但容忍失败
(WARN),运行时 `ensureRuntimeAssets()` 首次使用时补下。避免受限网络下构建硬失败。

## Consequences

- 听书获得完全离线的中文引擎;依赖未装(`ENABLE_LOCAL_TTS=0`)、模型未挂载或
  资产取不到时,Edge 保持兜底。
- 默认镜像(`ENABLE_LOCAL_TTS=0`)体积与构建时间不变;Next.js 构建在
  有包/无包两种场景下均通过(包名只用变量 + `webpackIgnore` 引用,默认构建
  永不解析它们)。
- 模型权重不进镜像:挂载 `./models/kokoro`(compose)或依赖持久化在线缓存;
  空挂载 = 未启用 = Edge。
- 本地已验证:`npm run typecheck` 全绿;`npm run test:tts-local` 真实合成中文
  WAV(RIFF 校验通过,短文约 7s);Next.js 生产构建在有包/无包两种场景均通过。
  完整 `docker compose build --build-arg ENABLE_LOCAL_TTS=1` 需在有 Docker 的
  主机执行(本工作区无 Docker)。
