# Novel Web Publisher 运行镜像
# 使用 Debian 版 Node 镜像,better-sqlite3 预编译包直接可用

# ── Stage 1: 依赖安装 ──
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY core/package.json   ./core/
COPY web/package.json    ./web/
COPY importer/package.json ./importer/
RUN npm install

# ── Stage 2: Next.js 构建 ──
FROM deps AS build
COPY core/    ./core/
COPY web/     ./web/
COPY tsconfig.json ./
RUN npm run build -w web

# ── Stage 3: 生产镜像 ──
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=33000

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

# 数据目录
RUN mkdir -p /app/data /app/web/public/covers

EXPOSE 33000
CMD ["npm", "run", "start", "-w", "web"]
