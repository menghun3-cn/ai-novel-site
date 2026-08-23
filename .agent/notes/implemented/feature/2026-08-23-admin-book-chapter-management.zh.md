# Agent Note: Admin book and chapter management in Content Core

Status: implemented

English | [中文](2026-08-23-admin-book-chapter-management.md)

## Problem

V2 之前,内容只能通过批量导入器进入系统(`upsertBook`/`importChapter` 是按
slug/章号幂等的 upsert)。没有办法显式新建一本书(slug 撞车会静默覆盖旧书)、
按 id 编辑、把小说下架但保留数据,或管理单章生命周期(自动章号新建、编辑、
下线、定时、删除、重排)。`BOOK_STATUSES` 根本没有 hidden 状态,
「隐藏」的小说仍会出现在所有公开页面上。

## Decision

`core/src/domain.ts` 给 `BOOK_STATUSES` 增加 `'hidden'`,新增类型化的
`CoreError(code)`(`CoreErrorCode`:`BOOK_NOT_FOUND`、`SLUG_TAKEN`、
`CHAPTER_NOT_FOUND`、`CHAPTER_NUMBER_CONFLICT`、`INVALID_CHAPTER_ORDER`、
`INVALID_STATUS`)以及管理侧输入类型(`CreateBookInput`、`UpdateBookPatch`、
`ListAllBooksOptions`、`CreateChapterInput`、`UpdateChapterPatch`)。

`core/src/service.ts` 新增管理侧分区。书籍:`createBook`(slug 撞车抛
`SLUG_TAKEN`——与导入器的幂等 upsert 不同)、`updateBook(id, patch)`
(局部补丁;提供 `tags` 时全量重建标签集)、`deleteBook`(事务内级联删除
章节与 book_tags)、`listAllBooks`(不做隐藏过滤,支持精确状态/分类/关键词
筛选)和 `getAnyBookById`。章节:`listChapters`(全状态)、
`getChapterByNumber`(任意状态)、`createChapter`(章号缺省取 max+1;显式
撞号抛 `CHAPTER_NUMBER_CONFLICT`;已删章号可复用)、`updateChapter`、
`deleteChapter`、`reorderChapters`(实参必须是现有章号的排列,否则抛
`INVALID_CHAPTER_ORDER`;两阶段重编号——先加偏移越过唯一约束,再落位——
避免事务中途撞上 `UNIQUE(book_id, number)`)。

`updateChapter` 的状态转换语义:转为 `published` 只记一次 `publishedAt`,
后续编辑不改写首次发布时间;退回 `draft` 取消定时(`scheduledAt` 清空);
转为 `hidden`(下线)保留 `publishedAt` 历史;`scheduledAt` 仅在状态为
`scheduled` 时保留,除非显式提供。

公开可见性:所有公开面——`listBooks`、`getBookBySlug`、`getBookById`、
`latestUpdates`、`rssItems`,以及传递依赖它们的 `searchBooks`、
`featuredBook`、`getChapterView`——现在都通过共享的 `PUBLIC_BOOK_VISIBLE`
谓词排除隐藏书籍。管理路径不提供修改书籍 slug 的能力(URL/RSS/Sitemap 稳定性)。

验证:`npm run test:core` 运行 `scripts/verify-admin-core.ts`,使用临时目录
数据库(`NOVEL_DATA_DIR`),覆盖增删改查、隐藏、转换语义、冲突、重排与级联删除。

## Alternatives considered

**`updateBook` 支持改 slug。**落选:slug 嵌在公开 URL、RSS GUID 与
Sitemap 里;改名会打断所有外链,而管理界面现阶段并不需要它。

**单章 `move(bookId, from, to)` 原语。**落选:任意移动同样要在 from 与
to 之间平移每一章,实现精细度不降反升;而整卷排列校验极其简单
(「必须是排列」),且能表达所有重排需求。

**让管理/API 层直接执行 SQL。**落选:会绕过让「隐藏」处处正确的统一可见性
规则;所有读写必须经由服务层。

**软删除(`deleted_at` 列)代替 `deleteBook`。**V2 阶段落选:隐藏已覆盖
「下架不丢数据」,硬删除与导入器幂等模型一致;只有将来出现回收站需求
才重新考虑。

## Consequences

收益:V2 内容管理六项能力有了经过测试的数据层;隐藏书籍在所有公开面同时
消失;类型化错误码让即将到来的管理 API 无需字符串匹配即可映射 HTTP 语义。
代价:公开查询形态变了(隐藏过滤)——任何缓存了书籍列表的外部读者必须容忍
条目消失;重排会改变章节章号进而改变章节 URL,这是「调整顺序」的固有代价,
但在 V3 定时发布落地时值得记住。
