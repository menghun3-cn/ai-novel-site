# syntax=docker/dockerfile:1
# Novel Web Publisher 运行镜像
# 设计目标:服务器上零编译——better-sqlite3 直接下载 npmmirror 的 linux-x64 预编译二进制,
#          npm 包全部走国内镜像;海外环境用 build-arg 覆盖即可切回官方源。
#
# 层缓存:依赖清单未变时,deps 阶段直接命中缓存,重复 ./rebuild.sh 秒级完成。
# npm 下载缓存:BuildKit cache mount 把 /root/.npm 跨构建持久化——即使 deps 层因
#              清单变更重建,包也走本地缓存,不再重复走网络下载所有依赖。

# ── Stage 1: 依赖安装(仅下载,无编译) ──
FROM node:22-slim AS deps
WORKDIR /app
# npm 包镜像源(默认国内;海外: --build-arg NPM_REGISTRY=https://registry.npmjs.org)
ARG NPM_REGISTRY=https://registry.npmmirror.com
# better-sqlite3 预编译二进制镜像(prebuild-install 约定变量,结构 {host}/v{version}/{file})
ARG SQLITE_BINARY_MIRROR=https://registry.npmmirror.com/-/binary/better-sqlite3
ENV npm_config_better_sqlite3_binary_host_mirror=$SQLITE_BINARY_MIRROR
# 本地 Kokoro TTS 开关:=1 时在 deps 阶段额外安装 kokoro-js-zh(中文 fork)+ onnxruntime-node(原生 .node 模块)。
# =0(默认)时镜像不含本地引擎,听书走 Edge 在线合成,体积不变。
# onnxruntime-node 1.29+ 的 Linux x64 CPU 二进制已捆绑在 npm 包内;其 install 脚本
# 默认还会按 manifest 下载未捆绑的 CUDA/GPU 二进制(NuGet,302 重定向且无 mirror 支持,
# 国内构建必失败)。CPU 推理用不到,用 --onnxruntime-node-install=skip 跳过该下载。
ARG ENABLE_LOCAL_TTS=0
COPY package.json package-lock.json* ./
COPY core/package.json   ./core/
COPY web/package.json    ./web/
COPY importer/package.json ./importer/
# 本地 TTS 资产补齐脚本(deps 阶段条件调用;勿内联 JS 到 Dockerfile——多行单引号脚本
# 无法用行尾 `\` 续行,会在 `const` 处触发 "unknown instruction" parse error)
COPY scripts/fetch-kokoro-voices.mjs ./scripts/
# cache mount 让 npm 下载缓存(/root/.npm)跨构建复用;--prefer-offline 让有缓存时
# 不再向 registry 反复请求元数据。即使 ./rebuild.sh --clean 也受益(缓存挂载与层缓存无关)。
RUN --mount=type=cache,target=/root/.npm npm config set registry "$NPM_REGISTRY" && npm install --prefer-offline
# 条件安装本地 TTS 依赖(--no-save:不改 package.json/package-lock,仅进 node_modules)。
# 注意:web/lib/kokoro-server.ts 对该依赖是「运行时动态 import + createRequire 探测」,
# 未安装时 ENABLE_LOCAL_TTS=0 的镜像构建/运行完全不受影响。
# 构建时同时补齐 kokoro-js-zh 的 Node 端硬性文件(见 kokoro-server.ts ensureRuntimeAssets):
#   - espeak-ng.wasm ← 从 espeak-ng 依赖包复制(该 npm 包漏发,不复制则中文 G2P 无法启动);
#   - 8 个中文语音 voices/*.bin ← 从 HF 下载(默认 hf-mirror;离线构建可跳过,运行时自动补)。
ARG KOKORO_HF_ENDPOINT=https://hf-mirror.com
# 跳过 onnxruntime-node install 脚本对未捆绑 CUDA/GPU 二进制的下载(CPU 推理用不到;
# CPU 二进制已捆绑在 npm 包内,skip 后完全离线安装,实测合成正常)。
# 注意两个变量都要设,覆盖两个版本的安装脚本:
#   - ONNXRUNTIME_NODE_INSTALL=skip        ← onnxruntime-node 1.29+(顶层显式安装);
#   - ONNXRUNTIME_NODE_INSTALL_CUDA=skip   ← onnxruntime-node 1.21.0(@huggingface/
#     transformers@3.8.1 硬编码依赖精确版本 1.21.0,会嵌套安装一份,其旧脚本只认
#     旧变量;不设则仍去 GitHub 下载 GPU tgz,国内网络 ECONNRESET 失败)。
# (嵌套副本仅在 1.21.0 的安装脚本里读取旧变量,运行时仍能正常加载 CPU 二进制。)
RUN if [ "$ENABLE_LOCAL_TTS" = "1" ]; then \
      ONNXRUNTIME_NODE_INSTALL=skip ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --no-save --package-lock=false kokoro-js-zh@2.1.7 onnxruntime-node@1.29.0 --prefer-offline \
      && node scripts/fetch-kokoro-voices.mjs "$KOKORO_HF_ENDPOINT" \
      && rm -f scripts/fetch-kokoro-voices.mjs; \
    fi

# ── Stage 2: Next.js 构建(纯 JS 打包,不涉及原生编译) ──
FROM deps AS build
COPY core/    ./core/
COPY web/     ./web/
COPY tsconfig.json ./
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js 编译缓存跨构建复用,依赖层重建时也无需全量重编译
RUN --mount=type=cache,target=/app/web/.next/cache npm run build -w web

# ── Stage 3: 生产镜像 ──
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=33000
ENV TZ=Asia/Shanghai

# 根 package.json(npm 工作区解析需要)
COPY package.json     ./
# 运行时依赖
COPY --from=deps      /app/node_modules  ./node_modules
# 核心包(查询 + 导入器)
COPY core/            ./core/
COPY importer/        ./importer/
# Next.js 构建产物
COPY --from=build     /app/web/.next     ./web/.next
COPY web/public/      ./web/public/
COPY web/package.json ./web/
# 章节 Markdown 渲染
COPY web/lib/         ./web/lib/

# 调度器入口脚本 + 单实例锁(scheduler 服务通过 compose 覆盖 CMD 启动)
COPY scripts/publish-scheduler.ts ./scripts/
COPY scripts/scheduler-lock.ts    ./scripts/

# 数据目录(compose 卷挂载覆盖)
RUN mkdir -p /app/data /app/web/public/covers

EXPOSE 33000
CMD ["npm", "run", "start", "-w", "web"]
