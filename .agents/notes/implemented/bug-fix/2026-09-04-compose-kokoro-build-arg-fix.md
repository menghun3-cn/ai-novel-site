# Agent Note: docker-compose 写死 ENABLE_LOCAL_TTS=0 导致线上无「本地语音」选项

Status: implemented

English | [中文](2026-09-04-compose-kokoro-build-arg-fix.zh.md)

## Problem

部署 v8.3.2(V10.7)后,线上听书播放器没有「Kokoro 本地语音」选项。探测线上
`GET /api/tts` 返回 `engines: ["edge","native"]`、`kokoro.available: false`,
但 `modelDir: "/app/models/kokoro"` 非空(说明模型卷已挂载且含 .onnx);
`POST engine=kokoro` 返回 503「镜像未启用 ENABLE_LOCAL_TTS,或模型未挂载」。
矛盾点指向依赖未安装,而非模型缺失。

根因:`docker-compose.yml` 的 `build.args` 写死
`ENABLE_LOCAL_TTS: "0"`。docker compose 构建时,compose 文件里的 args
**优先于命令行 `--build-arg`**,因此 `./rebuild.sh`(默认传
`--build-arg ENABLE_LOCAL_TTS=1`)被覆盖,镜像始终按 `ENABLE_LOCAL_TTS=0`
构建——deps 阶段不安装 `kokoro-js-zh`/`onnxruntime-node`,
`kokoroInstalled()` 返回 false,前端自然不展示 kokoro 引擎,仅剩 edge/native。

## Decision

从 `docker-compose.yml` 的 `build` 段**删除写死的 `args: ENABLE_LOCAL_TTS: "0"`**,
让构建参数改由调用方显式控制:

- `./rebuild.sh`(默认 `--build-arg ENABLE_LOCAL_TTS=1`)→ 镜像启用本地 TTS;
- `./rebuild.sh --no-tts` / `docker compose build --build-arg ENABLE_LOCAL_TTS=0` →
  显式关闭(镜像更小,听书仅 Edge);
- 裸 `docker compose build`(不传参数)→ 走 Dockerfile 默认
  `ARG ENABLE_LOCAL_TTS=0`(行为与写死 0 时一致,未受影响)。

保留原注释的要点并新增 ⚠ 警告:不要在此写死该参数(compose args 优先于
`--build-arg`,会静默覆盖 rebuild.sh 的启用参数)。

与
[local-kokoro-tts](../../implemented/feature/2026-09-03-local-kokoro-tts.md)
交叉链接:该笔记的「一键启用」假设构建参数能到达 Dockerfile;本修复揭示
compose 文件写死 args 会静默破坏该路径(引擎决策本身未变)。

## Alternatives considered

**把写死值改为 `"1"`。** 否决:这会让裸 `docker compose build` 也启用本地
TTS,与 Dockerfile 默认 0 的行为分裂,且 `--no-tts` 逃生门同样会被 compose
文件覆盖失效——与本次事故同构的坑,只是方向相反。

**在 rebuild.sh 里改用 `docker compose build --build-arg` 且要求用户删除
compose args。** 与直接删除等价的额外步骤,不加。

## Consequences

- 线上修复:重新 `./rebuild.sh`(或 `docker compose build --build-arg
  ENABLE_LOCAL_TTS=1` 后 `docker compose up -d`)重建镜像即恢复「本地语音」
  选项(模型卷已就绪,无需重新下载权重)。
- `docker compose config` 校验后 web 服务的 build 段不再声明该 arg,
  默认行为 = Dockerfile 默认(0),与删除前裸构建行为一致,无回归。
- 现有镜像/容器不受影响,只有重建时才生效;已部署站点需执行一次重建。
