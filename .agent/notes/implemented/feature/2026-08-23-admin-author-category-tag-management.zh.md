# Agent Note: Admin author, category, and tag management in Content Core

Status: implemented

English | [中文](2026-08-23-admin-author-category-tag-management.md)

## Problem

导入器通过 `upsertAuthor`/`upsertCategory`/`upsertTag` 隐式创建
作者/分类/标签,这些函数只会插入、从不更新:作者除了名字一无所有(没有路线图
「作者管理」要求的简介与头像),分类或标签名打错了不改 SQL 就无法纠正,
任何东西都删不掉。V2 管理后台需要对这三个实体做真正的管理
([相关:书籍与章节管理](../feature/2026-08-23-admin-book-chapter-management.md))。

## Decision

Schema(`core/src/db.ts`):`authors` 增加 `bio TEXT` 与 `avatar_path TEXT`。
新库由 DDL 直接建出;已有库由 `migrateAuthorColumns()` 幂等迁移——检查
`PRAGMA table_info(authors)`,只对缺失列执行 `ALTER TABLE ADD COLUMN`。

服务(`core/src/service.ts`):作者——`listAuthors()`(附 `bookCount`,降序)、
`getAuthor`、`updateAuthor(id, patch)`(名/简介/头像;撞名抛
`AUTHOR_NAME_TAKEN`)、`deleteAuthor`(仍被书籍引用抛 `AUTHOR_IN_USE`)。
分类——`createCategory(name)`(name 或 slug 撞车抛 `CATEGORY_NAME_TAKEN`)、
`updateCategory(id, patch)` 重命名、`deleteCategory`(被引用抛
`CATEGORY_IN_USE`)。标签——`createTag`、`getTag`、`updateTag`、
`deleteTag`(事务内先清 `book_tags`;`TAG_NAME_TAKEN`、`TAG_NOT_FOUND`)。
新增 `CoreErrorCode`:`AUTHOR_NOT_FOUND`、`AUTHOR_NAME_TAKEN`、
`AUTHOR_IN_USE`、`CATEGORY_NOT_FOUND`、`CATEGORY_NAME_TAKEN`、
`CATEGORY_IN_USE`、`TAG_NOT_FOUND`、`TAG_NAME_TAKEN`。
`Author` 携带可选 `bio`/`avatarPath`;`AuthorWithCount` 增加 `bookCount`。

分类与标签重命名绝不重新生成 slug——slug 在创建时派生一次并保持不可变
(分类 slug 是公开 URL 片段;标签为一致性遵循同一规则)。

验证:`npm run test:core` 在临时库场景中扩展了作者简介/头像更新、作品数、
改名撞车、在用删除守卫、操作顺序(先删引用的书)与标签级联删除——与
typecheck 一同全绿。

## Alternatives considered

**外键 `ON DELETE CASCADE` 代替显式守卫。**落选:一次误删把一位作者的
全部作品连带抹掉是灾难;显式 `*_IN_USE` 错误迫使管理员有意识地转移或删除书籍。

**重命名时重新生成 slug。**落选:`/categories/[slug]` 路由与未来的标签页会断;
被重命名的实体应保持同一身份。

**现在就为头像/封面建完整媒体记录。**延后:媒体管理是路线图中独立的一项;
在该 PR 落地前,作者 bio/avatar 只存路径字符串。

## Consequences

收益:V2 内容管理六模块中三个拥有了完整且经过测试的数据层;类型化错误码让
即将到来的管理 API 保持机械映射。代价:schema 演进有了两个必须保持对齐的
事实来源(新库 DDL 与老库 `migrateAuthorColumns`);重命名后已渲染缓存/RSS
中的旧名要等重新生成才消失——可接受,因为所有公开页面都从活库实时渲染。
