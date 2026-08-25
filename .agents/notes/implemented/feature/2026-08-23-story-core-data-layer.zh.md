# Agent Note: Story Core 数据层

Status: implemented

English | [中文](2026-08-23-story-core-data-layer.md)

## Problem

V4 AI 内容引擎需要一个把**故事事实**与已发布内容分开存放的地方:世界观、
人物及其当前状态、人物关系、故事线、逐章大纲、伏笔。Content Core
(`books`/`chapters`)不是合适的家——章节是可发布的成品,而这些是每次生成
都必须遵守的长期约束([路线图](../../../docs/AI原创内容创作平台.md) §6)。

## Decision

新增 `core/src/story.ts` 服务模块,落在 `db.ts` 六张新表上
(`story_worlds`、`story_characters`、`story_relationships`、`story_arcs`、
`story_outlines`、`story_foreshadowing`),全部以 `book_id` 为键,并在现有
DDL 里用 `CREATE TABLE IF NOT EXISTS` 建表——DDL 每次打开都会执行,存量库
无需迁移步骤。

值得记录的语义:

- **世界观**:每书一行;行不存在时读取返回*虚拟*空世界观,调用方永远不用
  判存在。
- **人物**:`(book_id, name)` UNIQUE + 按名 upsert——重提同名是更新而非
  重复;改名撞名抛 `CHARACTER_NAME_TAKEN`。role 是封闭联合
  (`protagonist/antagonist/supporting/minor`),由 `isCharacterRole` 守卫。
- **故事线**:状态封闭联合(`planned/active/done`),部分更新合并。
- **章节大纲**:按 `(book_id, number)` 经 `ON CONFLICT DO UPDATE` upsert。
- **伏笔**:`resolveForeshadowing` 用 `COALESCE(resolved_chapter, ?)` 写入
  回收章号——重复回收幂等且保留首次回收章;`openOnly` 过滤未回收项,供后续
  提示词组装。

每个函数先断言书存在(`BOOK_NOT_FOUND`),服务层不可能产生孤儿事实。新增六
个 `CoreErrorCode`;web 端穷举式 `STATUS_BY_CODE` 迫使同一次提交里补齐 API
映射——穷举检查发挥了作用。

验证:`scripts/verify-story-core.ts`(`npm run test:story`,约 28 项断言)
覆盖虚拟世界观默认值、人物 upsert 与重名守卫、跨书同名隔离、故事线状态
守卫、大纲幂等、伏笔回收幂等,全程使用临时数据库。

## Alternatives considered

**每书一个通用 JSON 大字段**(books.settings 列)。落选:实体没有独立身份,
无法定点更新/删除,查不了"哪些故事线活跃",提示词组装每次都要解析自由
JSON。

**分表但不做书存在断言。**落选:删书后服务层写入可能产生孤儿事实;断言让
每个入口天然安全。

**人物/故事线/大纲用 UUID。**保留整数自增:实体总是在书的范围内寻址,整数
让 URL 更短,唯一性由自然键(`book_id,name` / `book_id,number`)保证而非
随机 id。

## Consequences

收益:一个带类型、有测试的事实仓库,PR#14 的上下文组装器可以直接读,不碰
章节发布逻辑。代价:关系表存的是自由文本名字而非外键强制的人物 id——改人
名不会联动改关系;当前可接受,因为改名罕见且关系列表只是提示词的参考上
下文而非不变量来源;若 V5 自动流水线需要严格图完整性再收紧。
