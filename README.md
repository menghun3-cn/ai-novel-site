# AI Novel Site · AI 原创小说内容平台

AI 生成小说的**内容管理 + Web 阅读**一体化平台：从小说源文件导入、后台编审、AI 自动连载，到读者站阅读与数据闭环。

| | |
|---|---|
| 当前版本 | v8.x（V1–V8 全量落地，详见[功能规划](#功能规划与完成情况)） |
| 技术栈 | Node.js ≥ 20 · Next.js 15 (App Router) · TypeScript · SQLite(WAL) · Tailwind CSS · Zod |
| 协议 | [MIT](#协议mit) |

---

## 架构

```text
 novels/（MD/TXT 小说源，事实来源）
        │
        ▼
┌───────────────────┐   幂等导入   ┌────────────────────────────────────┐
│    Importer CLI   │ ──────────▶ │          Content Core（core/）      │
│ book.yaml + 章节MD │             │  领域模型 · 状态机 · 业务服务         │
└───────────────────┘             │  SQLite WAL（data/novel.db，单库共享）│
                                  └──────────────┬─────────────────────┘
                                                 │ 直接函数调用（同进程）
                     ┌───────────────────────────┴──────────────────────┐
                     ▼                                                  ▼
        ┌──────────────────────────┐                    ┌─────────────────────────────┐
        │   Web Publisher（web/）   │                    │   Scheduler（常驻调度器）      │
        │   Next.js 15 App Router  │                    │  · 到期定时章节发布            │
        │  ├─ 读者站 /(site)        │                    │  · 每书每日自动发布            │
        │  ├─ 管理后台 /admin       │                    │  · AI 自动连载(生成→质检→发布) │
        │  └─ API Routes /api/**   │                    └─────────────────────────────┘
        └──────────────────────────┘
```

**三个 npm workspaces + 一份 SQLite**：Web 与调度器以只读/写同库方式解耦运行；管理后台与调度器通过机器令牌或账号会话访问同一套 Core 服务。

### Content Core 模块划分（`core/src/`）

| 模块 | 职责 |
|---|---|
| `service.ts` | 书籍 / 章节 / 作者 / 分类 / 标签 CRUD 与查询，发布状态机（draft → pending_review → scheduled → published → hidden） |
| `story.ts` / `story-context.ts` | Story Core：世界观、人物、关系、故事线、章节大纲、伏笔；生成时组装上下文注入 AI |
| `ai-writer.ts` | AI 写手：调用 LLM 生成章节（OpenAI 兼容协议，支持模型自动发现），可选 LLM 质检 |
| `ai-serial.ts` | AI 自动连载：每书每日定时入队 → 生成 → 质检 → 送审 / 直接发布 |
| `reader.ts` | 读者系统：注册登录（scrypt 哈希）、会话、书架、收藏、订阅、阅读进度 |
| `discovery.ts` | Discovery 热度信号：PV / 完读统计，推荐候选 |
| `analytics.ts` | 数据分析：阅读会话、总览指标、单书完读率 / 留存漏斗 |
| `settings.ts` | 后台 LLM 配置（密钥掩码存储、连通性测试、模型发现） |
| `admin-auth.ts` | 管理员账号体系：默认账号播种、登录、强制改密、24h 会话 |
| `db.ts` | 连接管理 + 幂等 DDL + 轻量列迁移 |

### Web 页面结构（`web/app/`）

- **读者站 `(site)`**：首页推荐 / 全部小说 / 详情页 / 章节阅读（字号、深色模式、进度条、滑动翻页）/ 分类 / 搜索 / RSS · Sitemap · Robots / 注册登录 / 书架 / 阅读历史
- **管理后台 `/admin`**：概览、小说管理、审核队列、AI 创作中心、数据分析、作者 / 分类 / 标签、媒体库、系统设置（LLM）
- **API Routes `/api`**：`auth/*`（读者 Cookie 会话）、`admin/*`（令牌 / 账号会话鉴权）、`books/*`、`discovery`、`me/*`、`media/*`

---

## 功能规划与完成情况

> 版本路线源自 [`docs/AI原创内容创作平台.md`](docs/AI原创内容创作平台.md)，✅ = 已完成并带验证脚本，🚧 = 规划中。

### ✅ V1 内容基础
- MD/TXT 小说目录幂等导入（元数据 + 章节解析 + 封面复制）
- Content Core 五对象模型（Book / Chapter / Author / Category / Tag），SQLite WAL
- Web Publisher 阅读站（首页 / 书库 / 详情 / 阅读页 / 分类 / 搜索）
- RSS / Sitemap / Robots SEO 输出

### ✅ V2 内容管理（Admin）
- 管理后台：小说管理（含隐藏 / 恢复）、章节接排与重排、作者 / 分类 / 标签管理
- 媒体库：白名单格式上传、路径穿越防护、CSP 沙箱化对外服务
- **管理员账号体系**（v8.1）：初始化默认账号 `admin / Admin@123456`，首登强制改为复杂密码（≥10 位，含大小写 / 数字 / 特殊字符且不含账号名）；未改密前业务接口一律 `403 PASSWORD_CHANGE_REQUIRED`
- 双轨鉴权：账号会话（24h）+ `ADMIN_TOKEN` 机器令牌（供调度器 / 集成脚本）

### ✅ V3 发布系统
- 章节状态机：draft → 送审 → 批准（立即 / 定时）→ published；驳回带备注回 draft
- 审核队列工作台；每书自动发布配置（autopilot：开关 / 小时 / 每日篇数）
- 常驻调度器逐 tick 扫描到期章节并发布

### ✅ V4 AI 创作
- AI Writer：按书配置 LLM 生成整章，Story Core 上下文（世界观 / 人物 / 关系 / 大纲 / 伏笔）注入提示词
- Story Core 六类实体维护界面（AI 创作中心内）
- AI 质检：LLM Review 生成后自检再送审

### ✅ V5 AI 自动连载
- 每书每日自动生成 N 章：入队 → 生成 → 质检 → 自动送审 / 直接发布
- 生成任务队列（重试、错误记录、字数下限、模型指定）；手动触发与任务列表
- 后台 LLM 设置：密钥掩码、连通性测试、OpenAI 兼容模型自动发现

### ✅ V6 用户阅读
- 读者注册 / 登录 / 登出（httpOnly Cookie 会话，30 天）
- 书架（收藏 ∪ 订阅）、更新提示、订阅追更
- 阅读进度跨设备同步（节流上报）、最近阅读历史

### ✅ V7 推荐发现（Discovery）
- 热度信号采集：PV、滚动完读（匿名可报）
- 发现位推荐卡片（含推荐理由徽章）

### ✅ V8 数据闭环（Analytics）
- 阅读会话记录（时长 / 完读）
- 总览指标（7 日活跃会话等）+ 单章指标（PV / 完读率 / 平均时长 / 流失标记）+ 单书留存漏斗
- 分析结果反哺 AI 创作中心选题

### 🚧 规划中（未开始）
- 全文搜索（SQLite FTS5）、PostgreSQL 适配层
- 评论 / 打赏等读者互动
- 个性化推荐（基于阅读历史的猜你喜欢）
- Hermes 引擎深度集成、EPUB Publisher 与 BookOrbit 对接主流程化（现有独立 EPUB 构建线见 [`README-部署.md`](README-部署.md)）

---

## 目录结构

```text
.
├── core/                  # Content Core:领域模型 + SQLite + 业务服务(npm workspace)
├── importer/              # Importer CLI:novels/ → Content Core(npm workspace)
├── web/                   # Web Publisher:Next.js 15 读者站 + 管理后台(npm workspace)
├── scripts/               # verify-* 测试套件、publish-scheduler 调度器、工具脚本
├── src/                   # 旧 EPUB/BookOrbit 构建线(保留,见 README-部署.md)
├── docs/                  # 产品规划文档
├── novels/                # 小说导入源(事实来源)
├── data/                  # 运行时数据:data/novel.db(gitignore)
├── docker-compose.yml     # web(:33000) + scheduler 编排
├── Dockerfile             # 三阶段构建(零编译,预编译 better-sqlite3)
└── package.json           # npm workspaces 根
```

---

## 项目开发

### 环境要求

- Node.js ≥ 20(推荐 22)、npm;无原生编译依赖(better-sqlite3 使用预编译二进制)

### 本地开发

```bash
npm install                 # 安装全部 workspace 依赖

npm run dev:web             # 启动 Next.js 开发服务器(http://localhost:33000)
npm run import:novel -- novels/星海余烬   # 导入一本小说
npm run seed:100            # 生成 100 章测试小说(可选)

npm run scheduler           # 前台运行调度器(默认 60s 一 tick)
```

### 常用命令

| 命令 | 说明 |
|---|---|
| `npm run typecheck` | 根 + core + web 三层 TS 类型检查 |
| `npm run test:admin-auth` | 管理员账号体系验证(默认密码 / 强制改密 / 会话) |
| `npm run test:api` / `test:publish-api` | 管理 API / 发布工作流回归 |
| `npm run test:ai-api` / `test:ai-serial-api` | AI 写手 / 自动连载 API 回归 |
| `npm run test:reader` / `test:reader-api` | 读者核心 / 读者 API 回归 |
| `npm run test:media` / `test:settings` / `test:analytics` / `test:discovery-api` | 对应子系统回归 |
| `npm run build:web` && `npm run start:web` | 生产构建与启动 |

所有验证脚本使用临时数据库(`NOVEL_DATA_DIR`),不触碰 `data/novel.db`。

### 管理后台首次使用

1. 启动 Web 后访问 `http://localhost:33000/admin/login`;
2. 初始账号 **`admin` / `Admin@123456`**(数据库初始化时自动创建);
3. 首次登录**强制修改为复杂密码**,改密前无法访问任何后台业务功能;
4. 之后可随时通过顶栏 🔑 图标再次改密(会吊销该账号其他会话)。

---

## 部署

### 方式一:Docker Compose(推荐)

```bash
docker compose up -d          # 启动 web(:33000) + scheduler 两个服务
./rebuild.sh                  # 代码更新后一键重建镜像并重启
```

- `web`:Next.js 生产包,暴露 `33000`,挂载 `./data`(SQLite)、封面目录与 `novels/`;
- `scheduler`:不暴露端口,与 web 共享同一份 SQLite,负责定时发布与 AI 连载;
- Dockerfile 默认走国内镜像源(npmmirror + better-sqlite3 预编译),海外环境用 build-arg 切回官方源。

### 方式二:裸机运行

```bash
npm run build:web
NOVEL_DATA_DIR=/var/lib/novel PORT=33000 npm run start:web &
PUBLISH_TICK_SECONDS=60 NOVEL_DATA_DIR=/var/lib/novel npm run scheduler &
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NOVEL_DATA_DIR` | SQLite 数据目录 | `../data`(仓库内) |
| `PORT` | Web 监听端口 | `3000`(compose 内为 33000) |
| `NOVEL_SITE_URL` | RSS/Sitemap 站点地址 | `http://localhost:33000` |
| `PUBLISH_TICK_SECONDS` | 调度器扫描间隔(≥5) | `60` |
| `AI_FETCH_TIMEOUT_MS` | LLM 上游单次请求超时 | `300000`(5 分钟) |
| `ADMIN_TOKEN` | 可选机器令牌(Bearer/x-admin-token),供脚本集成;账号会话不受影响 | 未配置 |

> 每日连载/自动发布的「时刻」均按**北京时间**(UTC+8)解释,与宿主机时区无关;compose 已为容器设置 `TZ=Asia/Shanghai`。

### 上线核对清单

- [ ] `NOVEL_SITE_URL` 改为实际域名(RSS/Sitemap 用)
- [ ] 首次登录 `/admin` 并完成强制改密
- [ ] 系统设置里配置 LLM(AI 创作功能依赖)
- [ ] `docker compose logs -f scheduler` 确认调度心跳正常

---

## 协议(MIT)

本项目采用 **[MIT License](LICENSE)** 开源协议:

- ✅ 商用、修改、分发、私用均自由;
- ℹ️ 唯一条件:保留版权与许可声明;
- ⚠️ 软件按"现状"提供,作者不承担担保与责任。

```
MIT License © 2026 menghun3-cn
```
