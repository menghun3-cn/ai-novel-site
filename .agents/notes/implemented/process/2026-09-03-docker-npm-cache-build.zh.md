# Agent Note: Docker builds reuse npm downloads via BuildKit cache mounts

Status: implemented

English | [中文](2026-09-03-docker-npm-cache-build.zh.md)

## Problem

部署服务器上每次 `docker compose build` 都会重新下载整个 npm 依赖树。`deps` 阶段在 `npm install` 之前只 COPY 了清单文件,理论上清单未变时层缓存应命中——但一旦该层因任何原因重跑(清单变更、`rebuild.sh --clean`、`docker builder prune`、或 `--pull` 拉取新基础镜像),npm 就会重新走网络下载全部 tarball。npm 包缓存(`~/.npm`)位于容器层内,随层一起消失。Next.js 编译缓存同理:`build` 阶段重跑时全量重新编译。

## Decision

保留「先清单后安装」的层结构,并在 `Dockerfile` 中新增三层缓存机制:

1. **npm 下载缓存(BuildKit cache mount)**:`deps` 阶段用 `RUN --mount=type=cache,target=/root/.npm npm install --prefer-offline` 安装。npm 缓存从此跨构建持久化在宿主机上,即使 install 层重跑,包也走本地缓存而非重新下载;`--prefer-offline` 在缓存温热时避免多余的 registry 元数据往返。
2. **Next.js 编译缓存(cache mount)**:`build` 阶段用 `RUN --mount=type=cache,target=/app/web/.next/cache npm run build -w web`,依赖变更后重建无需全量重编译。
3. **`# syntax=docker/dockerfile:1` 头**:BuildKit 前端支持 cache mount 所需。
4. **缩小构建上下文**:`.dockerignore` 新增排除 `data`、`web/public/covers`、`web/.next`、`.dsh-tmp`——这些是卷挂载或本地产物,本就不该进入镜像上下文。

仍用 `npm install`(不换 `npm ci`):本仓库发布时会 bump 工作区版本号,但并非每次同步 `package-lock.json`,`npm ci` 遇到此类漂移会直接失败。cache mount 与是否 `npm ci` 无关,已解决下载问题。

## Alternatives considered

**把 `npm install` 换成 `npm ci`。** `npm ci` 确定性更强、更快,但 `package.json` 与 `package-lock.json` 漂移时会硬失败(本仓库发布 bump 有时会允许这种漂移)。要让 CI 全绿,需把发布流程锁定为每次重新生成 lockfile;暂缓。

**跨构建持久化 `node_modules` 本身(卷或 cache mount)。** `node_modules` 缓存挂载有风险:原生二进制(`better-sqlite3`)与平台相关状态可能在镜像间泄漏;npm tarball 缓存才是安全、内容寻址的共享层。

**只依赖层缓存。** 层缓存仍在且有用(清单未变 → install 层整体跳过),但 `--no-cache` 或被 prune 的构建上毫无收益;cache mount 恰好补上这些场景。

## Consequences

- 部署服务器热缓存重建不再重复下载依赖或重编译应用:重复 `./rebuild.sh` 很快,`--clean` 构建也能复用宿主机侧的 npm tarball 缓存。
- 依赖 BuildKit(`docker buildx` / Docker ≥ 23 默认 BuildKit);`# syntax` 头让旧 BuildKit 大声报错,而不是静默忽略挂载。
- `npm install --prefer-offline` 保证首次安装仍正确(此时缓存为空),热缓存安装则跳过冗余元数据请求。
- 远程构建时上下文在网络上传输更小(`data`、`web/public/covers` 是运行时卷挂载,`web/.next` 是本地产物)。