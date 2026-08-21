# AI Novel → Web Publisher

AI 生成小说的内容管理与 Web 阅读平台。

**Phase 1 已完成**:MD/TXT 小说目录 → Content Core → Web Publisher → 本地/服务器部署

## 架构总览

```text
              MD / TXT 小说目录
                     │
                     ▼
              ┌─────────────────┐
              │   Importer CLI  │  npm run import:novel
              │  book.yaml      │
              │  chapters/*.md  │
              └────────┬────────┘
                       │ 幂等导入
                       ▼
              ┌─────────────────┐
              │  Content Core   │  core/
              │  Book / Chapter │
              │  Author / Tag   │
              │  SQLite (WAL)   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Web Publisher  │  Next.js 15
              │  11 routes      │
              │  Tailwind CSS   │
              │  深色/字号/进度  │
              └─────────────────┘
```

## 功能

### Importer CLI

- 从 `novels/<书名>/` 目录导入小说到 Content Core
- 自动解析 `book.yaml` 元数据 + `chapters/*.md` 章节
- **幂等导入**:重复执行不产生重复数据,新增章节自动追加
- 自动复制封面到 `web/public/covers/`

### Content Core

- 五对象数据模型:Book / Chapter / Author / Category / Tag
- 发布状态机:draft → scheduled → published → hidden
- 统一可见性判定:只有 `published` 章节出现在任何页面
- SQLite + WAL 模式,支持高并发读

### Web Publisher

| 页面 | 路由 | 说明 |
|------|------|------|
| 首页 | `/` | 今日推荐 + 最新更新 + 小说库预览 |
| 全部小说 | `/books` | 分类筛选 + 卡片列表 |
| 小说详情 | `/books/[slug]` | 封面/简介/标签/章节列表 |
| 章节阅读 | `/books/[slug]/chapter/[number]` | 正文 + 字号/深色/进度 |
| 分类索引 | `/categories` | 所有分类 |
| 分类详情 | `/categories/[slug]` | 该分类下的小说 |
| 搜索 | `/search?q=` | 书名/作者/标签模糊搜索 |
| RSS | `/rss.xml` | 最新 20 章 |
| Sitemap | `/sitemap.xml` | SEO 站点地图 |
| Robots | `/robots.txt` | 爬虫规则 |

阅读页特性:字号调节(A−/A+)、深色/浅色模式、阅读进度条、上下章导航、localStorage 记忆。

## 目录结构

```text
.
├── core/                   # Content Core:领域模型 + SQLite + 内容 API
│   ├── src/
│   │   ├── domain.ts       # 类型定义 + 状态机常量
│   │   ├── db.ts           # 数据库连接 + 幂等建表
│   │   ├── service.ts      # 所有内容读写查询
│   │   └── index.ts        # 统一导出
│   └── package.json
├── importer/               # Importer CLI:MD/TXT → Content Core
│   ├── src/
│   │   └── index.ts        # 导入入口
│   └── package.json
├── web/                    # Web Publisher:Next.js 15
│   ├── app/                # 路由页面
│   ├── components/         # React 组件
│   ├── lib/                # 工具函数(markdown 渲染等)
│   └── package.json
├── novels/                 # 小说导入源(事实来源)
│   ├── 星海余烬/
│   │   ├── book.yaml       # 元数据
│   │   ├── cover.svg       # 封面(可选)
│   │   └── chapters/       # 章节 MD 文件
│   └── 深海回响/            # seed-100 生成的测试小说
├── scripts/                # 工具脚本
├── data/                   # 运行时:SQLite 数据库(gitignore)
├── src/                    # 旧 EPUB/BookOrbit 服务(Phase 2 保留)
└── package.json            # npm workspaces 根
```

## 快速开始

```bash
# 安装依赖
npm install

# 导入一本小说
npm run import:novel -- novels/星海余烬

# 验证数据
npm run check:core

# 生成 100 章测试小说(可选)
npm run seed:100
npm run import:novel -- novels/深海回响

# 启动 Web(开发模式)
npm run dev:web

# 构建 + 启动(生产模式)
npm run build:web
cd web && npx next start -p 3000
```

## book.yaml 格式

```yaml
title: 星海余烬
slug: xing-hai-yu-jin          # URL 友好的唯一标识
author: AI文学实验室
category: 科幻
tags:
  - 星际
  - 冒险
  - AI小说
description: 人类文明在星际战争后的废墟中重新建立。
status: serializing             # serializing | completed
chapterStatus: published        # 导入时的发布状态
cover: cover.svg                # 可选
```

## 章节文件格式

```markdown
# 第一章 余烬

星港在燃烧。

林澈站在瞭望塔的最高处，看着曾经灯火通明的人类首府……
```

- 文件名按数字排序:`001.md`, `002.md`, …
- 首个 `#` 标题自动识别为章节标题,并从正文剥离
- 无标题文件自动命名为「第 N 章」

## 数据库

SQLite 文件位于 `data/novel.db`,WAL 模式。

```sql
-- 核心表
books(id, slug, title, description, cover_path, status, author_id, category_id)
chapters(id, book_id, number, title, content_md, status, published_at)
authors(id, name)
categories(id, slug, name)
tags(id, slug, name)
book_tags(book_id, tag_id)
```

切换 PostgreSQL:只需替换 `core/src/db.ts` 和查询层,数据模型不变。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NOVEL_DATA_DIR` | 数据库目录 | `../data`(从 web/ 解析) |
| `NOVEL_SITE_URL` | RSS/Sitemap 的站点 URL | `http://localhost:3000` |

## Phase 2 规划

- [ ] Hermes AI 自动生成章节
- [ ] 定时发布(每日一章)
- [ ] EPUB Publisher(Content Core → EPUB)
- [ ] BookOrbit 同步
- [ ] PostgreSQL 数据库
- [ ] 全文搜索(FTS5)
- [ ] 用户系统 / 评论 / 收藏
