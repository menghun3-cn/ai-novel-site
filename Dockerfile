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
# onnxruntime-node 的预编译二进制走 GitHub releases,国内构建用
#   --build-arg ONNX_BINARY_MIRROR=https://registry.npmmirror.com/-/binary/onnxruntime 切镜像。
ARG ENABLE_LOCAL_TTS=0
ARG ONNX_BINARY_MIRROR=
ENV npm_config_onnxruntime_binary_host_mirror=$ONNX_BINARY_MIRROR
COPY package.json package-lock.json* ./
COPY core/package.json   ./core/
COPY web/package.json    ./web/
COPY importer/package.json ./importer/
# cache mount 让 npm 下载缓存(/root/.npm)跨构建复用;--prefer-offline 让有缓存时
# 不再向 registry 反复请求元数据。即使 ./rebuild.sh --clean 也受益(缓存挂载与层缓存无关)。
RUN --mount=type=cache,target=/root/.npm npm config set registry "$NPM_REGISTRY" && npm install --prefer-offline
# 条件安装本地 TTS 依赖(--no-save:不改 package.json/package-lock,仅进 node_modules)。
# 注意:web/lib/kokoro-server.ts 对该依赖是「运行时动态 import + createRequire 探测」,
# 未安装时 ENABLE_LOCAL_TTS=0 的镜像构建/运行完全不受影响。
# 构建时同时补齐 kokoro-js-zh 的 Node 端硬性文件(见 kokoro-server.ts ensureRuntimeAssets):
#   - espeak-ng.wasm ← 从 espeak-ng 依赖包复制(该 npm 包漏发,不复制则中文 G2P 无法启动);
#   - 8 个中文语音 voices/*.bin ← 从 HF 下载(默认 hf-mirror;离线构建可跳过,运行时自动补)。
# node:22-slim 无 curl,用 Node 内置 fetch 下载。
ARG KOKORO_HF_ENDPOINT=https://hf-mirror.com
RUN if [ "$ENABLE_LOCAL_TTS" = "1" ]; then \
      npm install --no-save --package-lock=false kokoro-js-zh@2.1.7 onnxruntime-node@1.29.0 --prefer-offline \
      && PKG_DIR=node_modules/kokoro-js-zh \
      && mkdir -p "$PKG_DIR/dist" "$PKG_DIR/voices" \
      && cp node_modules/espeak-ng/dist/espeak-ng.wasm "$PKG_DIR/dist/espeak-ng.wasm" \
      && export KOKORO_HF_ENDPOINT="$KOKORO_HF_ENDPOINT" \
      && node -e '
          const fs = require("fs"), path = require("path");
          const voices = ["zf_xiaoxiao","zf_xiaobei","zf_xiaoni","zf_xiaoyi","zm_yunjian","zm_yunxi","zm_yunxia","zm_yunyang"];
          const base = process.env.KOKORO_HF_ENDPOINT + "/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/";
          (async () => {
            let failed = 0;
            for (const v of voices) {
              const dest = path.join("node_modules/kokoro-js-zh/voices", v + ".bin");
              if (fs.existsSync(dest)) continue;
              try {
                const r = await fetch(base + v + ".bin", { signal: AbortSignal.timeout(60000) });
                if (!r.ok) throw new Error("HTTP " + r.status);
                fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
                console.log("voice ok:", v);
              } catch (e) {
                failed++;
                console.log("WARN: voice download failed (" + v + "): " + e.message + " — 运行时自动补下");
              }
            }
            if (failed) console.log("WARN: " + failed + " 个语音文件构建时未下载,首次合成时自动补齐(需容器可访问 HF)");
          })();
        '; \
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
