# Novel Web Publisher 运行镜像
# 设计目标:服务器上零编译——better-sqlite3 直接下载 npmmirror 的 linux-x64 预编译二进制,
#          npm 包全部走国内镜像;海外环境用 build-arg 覆盖即可切回官方源。
#
# 层缓存:依赖清单未变时,deps 阶段直接命中缓存,重复 ./rebuild.sh 秒级完成。

# ── Stage 1: 依赖安装(仅下载,无编译) ──
FROM node:22-slim AS deps
WORKDIR /app
# npm 包镜像源(默认国内;海外: --build-arg NPM_REGISTRY=https://registry.npmjs.org)
ARG NPM_REGISTRY=https://registry.npmmirror.com
# better-sqlite3 预编译二进制镜像(prebuild-install 约定变量,结构 {host}/v{version}/{file})
ARG SQLITE_BINARY_MIRROR=https://registry.npmmirror.com/-/binary/better-sqlite3
ENV npm_config_better_sqlite3_binary_host_mirror=$SQLITE_BINARY_MIRROR
COPY package.json package-lock.json* ./
COPY core/package.json   ./core/
COPY web/package.json    ./web/
COPY importer/package.json ./importer/
RUN npm config set registry "$NPM_REGISTRY" && npm install

# ── Stage 2: Next.js 构建(纯 JS 打包,不涉及原生编译) ──
FROM deps AS build
COPY core/    ./core/
COPY web/     ./web/
COPY tsconfig.json ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w web

# ── Stage 3: 生产镜像 ──
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=33000

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

# 数据目录(compose 卷挂载覆盖)
RUN mkdir -p /app/data /app/web/public/covers

EXPOSE 33000
CMD ["npm", "run", "start", "-w", "web"]
