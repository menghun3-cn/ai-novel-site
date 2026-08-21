# MD/TXT 小说目录 → EPUB → BookOrbit 自动化方案

> 完整技术架构、目录规范、构建流程与自动同步设计  
> 版本：V1.0  
> 适用场景：个人小说库、AI 自动创作小说、NAS 自托管阅读平台

---

## 目录

1. [方案目标](#1-方案目标)
2. [总体架构](#2-总体架构)
3. [核心设计原则](#3-核心设计原则)
4. [小说目录规范](#4-小说目录规范)
5. [bookyaml 元数据规范](#5-bookyaml-元数据规范)
6. [Markdown / TXT 章节规范](#6-markdown--txt-章节规范)
7. [章节解析器设计](#7-章节解析器设计)
8. [EPUB 生成器设计](#8-epub-生成器设计)
9. [EPUB 目录与阅读体验](#9-epub-目录与阅读体验)
10. [增量更新机制](#10-增量更新机制)
11. [Manifest 与版本管理](#11-manifest-与版本管理)
12. [BookOrbit 同步方案](#12-bookorbit-同步方案)
13. [文件监控与自动构建](#13-文件监控与自动构建)
14. [防止文件写入未完成](#14-防止文件写入未完成)
15. [Docker 部署方案](#15-docker-部署方案)
16. [推荐技术栈](#16-推荐技术栈)
17. [服务 API 设计](#17-服务-api-设计)
18. [完整自动化流水线](#18-完整自动化流水线)
19. [MVP 实施范围](#19-mvp-实施范围)
20. [后续增强方向](#20-后续增强方向)
21. [验收标准](#21-验收标准)
22. [推荐最终目录结构](#22-推荐最终目录结构)
23. [结论](#23-结论)

---

# 1. 方案目标

本方案用于解决：

> 小说内容以 Markdown/TXT 文件保存，一本小说由多个章节文件组成，希望自动转换为标准 EPUB，再自动导入 BookOrbit 阅读。

最终目标：

- 支持一本小说对应一个目录。
- 支持 Markdown 单章节文件。
- 支持 TXT 单章节文件。
- 支持一个 TXT 文件包含整本小说并自动拆章。
- 自动识别章节顺序和章节标题。
- 自动生成 EPUB 3。
- 自动生成 EPUB 目录、封面和书籍元数据。
- 章节新增后自动重新构建 EPUB。
- 通过 BookOrbit Book Dock 自动导入。
- 保留 REST API 同步能力的扩展接口。
- 源文件与 EPUB、BookOrbit 完全解耦，未来可以切换其他阅读平台。

---

# 2. 总体架构

```text
                    小说源目录
                        │
             ┌──────────┴──────────┐
             │                     │
          Markdown                 TXT
             │                     │
             └──────────┬──────────┘
                        ▼
              ┌──────────────────┐
              │ Novel Builder    │
              │ 小说构建服务      │
              └────────┬─────────┘
                       │
            ┌──────────┼──────────┐
            │          │          │
          解析       排序       元数据
            │          │          │
            └──────────┼──────────┘
                       ▼
                EPUB Generator
                       │
                       ▼
              /bookdock/*.epub
                       │
                       ▼
              ┌─────────────────┐
              │   BookOrbit     │
              │   Book Dock     │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Web阅读       Kobo        KOReader
```

核心思想：

**不要修改 BookOrbit，让它直接承担 Markdown/TXT 解析。**

而是建立一个独立的 **Novel Builder**：

```text
MD / TXT
   ↓
Novel Builder
   ↓
EPUB
   ↓
BookOrbit
```

Novel Builder 负责非标准小说源文件转换为标准 EPUB，BookOrbit 只负责书库管理和阅读。

---

# 3. 核心设计原则

## 3.1 内容源与阅读平台解耦

`novels/` 永远是事实来源。

BookOrbit 只是阅读消费端，不作为原始数据源。

## 3.2 一本小说对应一个 EPUB

不要：

```text
001.md → 001.epub
002.md → 002.epub
003.md → 003.epub
```

应该：

```text
001.md
002.md
003.md
   ↓
小说.epub
```

## 3.3 每个章节最好独立保存

便于：

- AI 生成
- 增量更新
- 故障恢复
- 章节重新处理
- 版本管理

## 3.4 构建过程必须幂等

相同输入重复执行，应该得到一致结果。

## 3.5 同步必须可重试

BookOrbit 暂时不可用时，不应该丢失任务。

## 3.6 不直接修改 BookOrbit 数据库

优先使用 Book Dock。

## 3.7 预留 Adapter

建议：

```text
BookOrbitAdapter
├── BookDockAdapter
└── ApiAdapter
```

第一版实现 `BookDockAdapter`，后续再实现 REST API。

## 3.8 使用 Manifest

用于：

- 版本
- 章节数
- 内容哈希
- 构建时间
- 同步状态

---

# 4. 小说目录规范

推荐：

```text
novel-library/
│
├── novels/
│   ├── 三体/
│   │   ├── book.yaml
│   │   ├── cover.jpg
│   │   ├── chapters/
│   │   │   ├── 001.md
│   │   │   ├── 002.md
│   │   │   └── 003.md
│   │   └── assets/
│   │
│   └── AI小说001/
│       ├── book.yaml
│       ├── cover.jpg
│       └── chapters/
│           ├── 001.md
│           └── 002.md
│
├── output/
│   ├── 三体.epub
│   └── AI小说001.epub
│
└── bookdock/
    └── 三体.epub
```

目录职责：

| 目录 | 用途 |
|---|---|
| `novels/` | 原始小说数据，核心数据源 |
| `output/` | 构建后的 EPUB |
| `bookdock/` | BookOrbit 自动导入目录 |
| `assets/` | 章节插图等资源 |
| `cover.jpg` | 小说封面 |
| `book.yaml` | 书籍元数据 |

---

# 5. book.yaml 元数据规范

示例：

```yaml
title: 三体
author: 刘慈欣
language: zh-CN

description: |
  《三体》是一部科幻小说。

publisher: AI Literature
year: 2026

tags:
  - 科幻
  - 中国科幻

series:
  name: 三体
  index: 1

cover: cover.jpg
```

AI 小说示例：

```yaml
title: 星海余烬
author: AI文学实验室
language: zh-CN

description: |
  人类文明在星际战争后的废墟中重新建立。

tags:
  - 科幻
  - 星际
  - AI小说

cover: cover.jpg
```

后续可以扩展：

```yaml
status: serializing
chapterCount: 105
source: ai-generated
createdAt: 2026-08-21
updatedAt: 2026-08-21
rights: original
```

---

# 6. Markdown / TXT 章节规范

## 6.1 Markdown 单章节

```markdown
# 第一章 陨落的天才

萧炎站在广场中央。

天空刚刚下过雨。

“萧炎，三年之约，你还记得吗？”
```

推荐：

```text
chapters/
├── 001.md
├── 002.md
└── 003.md
```

---

## 6.2 TXT 单章节

```text
第一章 陨落的天才

萧炎站在广场中央。

天空刚刚下过雨。
```

目录：

```text
chapters/
├── 001.txt
├── 002.txt
└── 003.txt
```

---

## 6.3 一个 TXT 包含整本小说

例如：

```text
第一章 陨落的天才

xxxxxxxx

第二章 休书

xxxxxxxx

第三章 聚气散

xxxxxxxx
```

程序自动拆分。

推荐识别：

```text
第1章
第一章
第001章

第1节
第一节

序章
楔子
尾声
番外
附录
```

---

# 7. 章节解析器设计

建议：

```text
Parser
│
├── MarkdownParser
├── TxtParser
└── DirectoryParser
```

统一输出：

```typescript
interface Chapter {
  id: string
  order: number
  title: string
  content: string
  sourceFile: string
}
```

例如：

```json
{
  "id": "001",
  "order": 1,
  "title": "第一章 陨落的天才",
  "content": "萧炎站在广场中央……",
  "sourceFile": "001.md"
}
```

这样 EPUB Generator 不需要关心原始内容到底是 MD 还是 TXT。

---

# 8. EPUB 生成器设计

推荐生成 **EPUB 3**。

至少包含：

- title
- author
- language
- description
- cover
- 目录
- 章节 XHTML
- EPUB metadata
- CSS
- 图片资源

结构：

```text
EPUB
│
├── metadata
│   ├── title
│   ├── author
│   ├── language
│   └── description
│
├── cover
├── toc
└── chapters
    ├── chapter001.xhtml
    ├── chapter002.xhtml
    └── chapter003.xhtml
```

---

# 9. EPUB 目录与阅读体验

最终目录：

```text
目录

第一章 陨落的天才
第二章 休书
第三章 聚气散
第四章 萧家
第五章 魔兽山脉
```

要求：

- 每章独立 XHTML。
- 章节标题进入 EPUB 导航目录。
- 正文统一 CSS。
- 封面作为 EPUB 标准封面资源。
- 使用 UTF-8。
- 中文内容不能乱码。
- 目录中的章节可以直接点击跳转。

这样 BookOrbit 阅读时可以正常进行章节导航。

---

# 10. 增量更新机制

第一天：

```text
chapters/
├── 001.md
├── 002.md
└── 003.md
```

生成：

```text
星海余烬.epub
```

第二天：

```text
chapters/
├── 001.md
├── 002.md
├── 003.md
└── 004.md
```

系统检测：

```text
001 → 已存在
002 → 已存在
003 → 已存在
004 → 新章节
```

然后重新构建：

```text
星海余烬.epub
```

### 第一版推荐

直接重新生成整本 EPUB。

不建议第一版就实现 EPUB 二进制级增量修改。

原因：

- 实现简单
- 稳定
- 容易验证
- 对普通小说性能足够
- 不容易产生 EPUB 内部结构损坏

---

# 11. Manifest 与版本管理

每本小说保存：

```text
.manifest.json
```

示例：

```json
{
  "title": "星海余烬",
  "version": 4,
  "chapterCount": 104,
  "lastChapter": "104",
  "contentHash": "sha256:xxxx",
  "generatedAt": "2026-08-21T12:00:00Z"
}
```

作用：

- 判断章节是否变化
- 判断内容是否变化
- 判断是否需要重新生成 EPUB
- 判断是否需要同步 BookOrbit
- 支持失败恢复
- 防止重复任务

推荐使用：

```text
SHA-256
```

计算内容哈希。

---

# 12. BookOrbit 同步方案

## 12.1 第一阶段：Book Dock

推荐：

```text
EPUB Builder
     │
     ▼
/bookdock
     │
     ▼
BookOrbit
     │
     ▼
自动导入
```

BookOrbit 已提供 Book Dock drop folder 自动导入机制。

因此第一版：

**不要直接修改 BookOrbit 数据库。**

---

## 12.2 第二阶段：REST API

未来可以：

```text
EPUB Builder
      │
      ▼
BookOrbit REST API
      │
      ▼
创建/更新书籍
```

统一抽象：

```typescript
interface BookOrbitAdapter {
  sync(book: Book): Promise<void>
}
```

实现：

```text
BookOrbitAdapter
│
├── BookDockAdapter
└── ApiAdapter
```

---

# 13. 文件监控与自动构建

监控：

```text
novels/
└── 星海余烬/
    └── chapters/
```

发现：

```text
105.md
```

触发：

```text
File Watcher
      ↓
发现 105.md
      ↓
等待文件写入完成
      ↓
重新扫描小说
      ↓
生成 EPUB
      ↓
验证 EPUB
      ↓
计算 SHA256
      ↓
复制到 Book Dock
      ↓
BookOrbit 自动导入
```

推荐：

```text
chokidar
```

实现文件监听。

必须增加：

- debounce 防抖
- duplicate event 去重
- task queue
- retry 重试
- file stability check

---

# 14. 防止文件写入未完成

AI 生成章节时，不能：

```text
检测到 105.md
↓
立即构建 EPUB
```

因为文件可能还没有写完。

## 14.1 稳定性检查

```text
检测到新文件
    ↓
等待 2 秒
    ↓
检查文件大小
    ↓
再次等待
    ↓
再次检查
    ↓
大小/修改时间一致
    ↓
确认写入完成
    ↓
触发构建
```

---

## 14.2 临时文件 + 原子重命名

更推荐：

```text
105.md.tmp
      ↓
写入完成
      ↓
rename
      ↓
105.md
```

监听器只监听：

```text
*.md
*.txt
```

而不监听：

```text
*.tmp
```

这是 AI 自动生成章节场景下更可靠的方案。

---

# 15. Docker 部署方案

推荐：

```text
docker-compose
│
├── bookorbit
│
├── novel-builder
│
└── redis（可选）
```

共享：

```text
/data
│
├── novels
├── output
└── bookdock
```

容器职责：

### BookOrbit

负责：

- 书库
- 阅读
- 用户
- 阅读进度
- 书籍同步

### Novel Builder

负责：

- 扫描目录
- MD/TXT 解析
- 章节识别
- EPUB 构建
- EPUB 验证
- Manifest
- 文件监听
- BookOrbit 同步

### Redis（可选）

负责：

- 任务队列
- 分布式锁
- 失败重试
- 并发控制

Novel Builder 和 BookOrbit 共同挂载：

```text
/data/bookdock
```

Novel Builder 写入 EPUB，BookOrbit 自动消费。

---

# 16. 推荐技术栈

| 模块 | 推荐技术 | 用途 |
|---|---|---|
| 核心服务 | Node.js + TypeScript | 主服务 |
| Markdown | unified / remark | Markdown 解析 |
| Schema | Zod | 配置与输入校验 |
| 文件监听 | chokidar | 文件变化检测 |
| HTTP API | Fastify | 管理接口 |
| 日志 | Pino | 结构化日志 |
| 队列 | Redis + BullMQ（可选） | 异步任务 |
| 部署 | Docker Compose | 自托管 |

推荐 Node.js + TypeScript 的原因：

- 与 AI 自动化系统容易集成。
- 文件处理方便。
- 后续 API 和后台开发方便。
- 类型系统适合复杂的小说元数据模型。

---

# 17. 服务 API 设计

建议 Novel Builder 提供：

| API | 用途 |
|---|---|
| `POST /api/build` | 构建指定小说 EPUB |
| `POST /api/sync` | 构建并同步 BookOrbit |
| `GET /api/books` | 查看小说列表 |
| `GET /api/books/:id` | 查看构建状态 |
| `POST /api/rebuild` | 强制重新构建 |
| `GET /api/health` | 健康检查 |

## 构建

```http
POST /api/build
```

```json
{
  "book": "星海余烬"
}
```

## 同步

```http
POST /api/sync
```

```json
{
  "book": "星海余烬"
}
```

流程：

```text
扫描小说
    ↓
解析章节
    ↓
生成 EPUB
    ↓
验证 EPUB
    ↓
计算 SHA256
    ↓
投递 Book Dock
    ↓
返回结果
```

---

# 18. 完整自动化流水线

如果与 AI 小说生成系统结合：

```text
                    AI
                    │
                    ▼
              生成章节 MD
                    │
                    ▼
              Novel Manager
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
      元数据      章节管理     封面
        │           │           │
        └───────────┼───────────┘
                    ▼
              EPUB Builder
                    │
                    ▼
             EPUB Validator
                    │
                    ▼
             BookOrbit Dock
                    │
                    ▼
              ┌─────┴─────┐
              ▼           ▼
           Web阅读       Kobo
```

如果同时有公开小说网站：

```text
AI小说
   │
   ├── Cloudflare 网站
   ├── RSS
   └── BookOrbit
```

最终形成：

> AI 负责创作  
> ↓  
> Markdown 负责内容源  
> ↓  
> EPUB 负责标准化  
> ↓  
> BookOrbit 负责私人阅读  
> ↓  
> Cloudflare 负责公开发布

---

# 19. MVP 实施范围

第一版严格控制范围，只实现：

1. 扫描小说目录
2. 支持 Markdown
3. 支持 TXT
4. 自动识别章节
5. 自动生成 EPUB 3
6. 自动生成目录、封面和元数据
7. 文件变化自动重新构建
8. 自动投递 BookOrbit Book Dock

第一版暂不实现：

- 直接操作 BookOrbit 数据库
- 复杂 BookOrbit 管理后台
- EPUB 二进制级增量修改
- 复杂用户权限
- AI 写作本身
- 分布式任务系统

---

# 20. 后续增强方向

后续可以逐步增加：

- BookOrbit REST API 同步
- 构建任务队列
- 失败重试
- EPUB 自动校验
- 章节内容版本管理
- 章节回滚
- AI 自动生成封面
- AI 自动生成书名
- AI 自动生成简介
- AI 自动生成标签
- Web 管理后台
- 多书库 / 多作者
- Cloudflare 自动发布
- RSS 自动发布
- Kobo / KOReader 专项优化
- 阅读数据回流
- 自动生成 MOBI / AZW3 / KEPUB 等格式

---

# 21. 验收标准

## 21.1 内容

- [ ] 一本小说可以由多个 MD/TXT 文件组成
- [ ] 章节顺序稳定
- [ ] 中文、英文、数字、特殊符号不乱码
- [ ] Markdown 标题正确转换为章节标题
- [ ] TXT 能按规则自动拆章
- [ ] 文件名排序规则明确

## 21.2 EPUB

- [ ] 生成有效 EPUB 3
- [ ] 书名正确
- [ ] 作者正确
- [ ] 简介正确
- [ ] 语言正确
- [ ] 封面正确
- [ ] 目录可点击
- [ ] 每章独立页面
- [ ] 常见阅读器能够打开

## 21.3 自动化

- [ ] 新增章节自动触发构建
- [ ] 文件未写完不会触发错误构建
- [ ] 重复文件事件不会产生重复任务
- [ ] 构建失败有日志
- [ ] 同步失败可以重试
- [ ] 相同内容不会无意义重复同步
- [ ] 服务重启后任务状态不会丢失

## 21.4 BookOrbit

- [ ] EPUB 能进入 Book Dock
- [ ] BookOrbit 能识别书名
- [ ] BookOrbit 能识别作者
- [ ] BookOrbit 能识别章节
- [ ] 目录正常
- [ ] 阅读进度正常
- [ ] 更新小说不会无限产生重复书籍

---

# 22. 推荐最终目录结构

```text
novel-system/
│
├── novels/                         # 永久内容源
│   ├── 星海余烬/
│   │   ├── book.yaml
│   │   ├── cover.jpg
│   │   ├── chapters/
│   │   │   ├── 001.md
│   │   │   ├── 002.md
│   │   │   └── 003.md
│   │   ├── assets/
│   │   └── .manifest.json
│   │
│   └── 另一部小说/
│
├── output/                         # EPUB 构建产物
│   ├── 星海余烬.epub
│   └── 另一部小说.epub
│
├── bookdock/                       # BookOrbit 投递目录
│   └── 星海余烬.epub
│
├── logs/
│
└── config/
    └── config.yaml
```

---

# 23. 结论

本方案最重要的架构决策是：

> **不要让 BookOrbit 成为小说源数据管理器。**

而是：

```text
Markdown/TXT
     ↓
小说目录
     ↓
Novel Builder
     ↓
EPUB 3
     ↓
BookOrbit Book Dock
     ↓
阅读
```

你的真正数据源永远是：

```text
novels/
```

BookOrbit 只是最终消费端。

这样未来即使不使用 BookOrbit，也可以增加其他输出 Adapter：

```text
novels/
   │
   ▼
Novel Builder
   │
   ├── BookOrbit
   ├── Calibre
   ├── Kavita
   ├── BookLore
   ├── 自研阅读器
   └── Web小说站
```

无需重新整理小说原始数据。

---

# 24. 推荐实施顺序

建议按照以下顺序开发：

```text
① MD/TXT → Chapter Parser
        ↓
② Chapter → EPUB 3
        ↓
③ book.yaml + cover
        ↓
④ Manifest + SHA256
        ↓
⑤ 文件监听
        ↓
⑥ BookOrbit Book Dock
        ↓
⑦ 任务队列与失败重试
        ↓
⑧ BookOrbit REST API
        ↓
⑨ Web 管理后台
        ↓
⑩ AI 小说自动创作与发布
```

第一阶段完成后，就已经能够实现：

> **把一个包含几十、几百甚至上千个 Markdown/TXT 章节的小说目录，自动转换成一本结构完整的 EPUB，并自动进入 BookOrbit 阅读。**

---

## 附录：相关官方资料

- BookOrbit GitHub：<https://github.com/bookorbit/bookorbit>
- BookOrbit Releases：<https://github.com/bookorbit/bookorbit/releases>
