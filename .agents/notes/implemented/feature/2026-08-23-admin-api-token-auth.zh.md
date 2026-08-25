# Agent Note: Admin API route handlers with token auth

Status: implemented

English | [中文](2026-08-23-admin-api-token-auth.md)

## Problem

core 的管理服务([书籍/章节](../feature/2026-08-23-admin-book-chapter-management.md)、
[作者/分类/标签](../feature/2026-08-23-admin-author-category-tag-management.md))
没有任何 HTTP 入口。即将开发的后台 UI 需要从浏览器调用它们,路线图后续阶段
(V4 AI 引擎、V5 自动连载、Hermes 集成)也需要从 Next.js 进程之外推送内容的
稳定通道。没有显式 API 契约,未来的每个消费方都会被引诱去直接摸数据库。

## Decision

`web/app/api/admin/**` 以 Next.js 15 Route Handler(plain `Response`,
`dynamic = 'force-dynamic'`)暴露管理面:

- `GET|POST /api/admin/books`,`GET|PATCH|DELETE /api/admin/books/[id]`
- `GET|POST /api/admin/books/[id]/chapters`,
  `GET|PATCH|DELETE /api/admin/books/[id]/chapters/[number]`,
  `PUT /api/admin/books/[id]/chapters/order`
- `GET|POST /api/admin/authors`,`GET|PATCH|DELETE /api/admin/authors/[id]`
- `GET|POST /api/admin/categories`,`GET|PATCH|DELETE /api/admin/categories/[id]`
- `GET|POST /api/admin/tags`,`GET|PATCH|DELETE /api/admin/tags/[id]`

共享行为集中在 `web/lib/admin-api.ts`:`withAdmin()` 包装每个处理器
(鉴权 → 业务 → 错误映射);请求体经 zod 校验(`VALIDATION_FAILED`/
`INVALID_JSON` → 400,slug 模式在边界强制);每个 `CoreError` code 机械映射
HTTP——`*_NOT_FOUND` → 404,`*_TAKEN`/`*_IN_USE`/`CHAPTER_NUMBER_CONFLICT`
→ 409,`INVALID_*` → 400;未知错误记日志并返回不带细节的 500。

鉴权(V2 范围):环境变量 `ADMIN_TOKEN` 与 `Authorization: Bearer` 头或
`x-admin-token` 头比较,采用定长 SHA-256 摘要的时序安全比较(不泄露长度)。
未配置 `ADMIN_TOKEN` 时整个管理 API 一律回答 `503 ADMIN_API_DISABLED`,
而不是意外敞开。面向读者的用户系统仍属 V6。

验证:`npm run test:api`(`scripts/verify-admin-api.ts`)以函数方式直接调用
路由处理器、使用临时目录数据库——覆盖鉴权(401/503)、CRUD 正常路径与全部
错误映射类(400/404/409),共 20 项。

## Alternatives considered

**在 Next.js 旁再起一个 Fastify 服务。**落选:两个部署物、两套鉴权故事,
还要为与网站同界面的后台复制一遍 CORS/会话管线;route handler 让进程与
部署都保持一个。

**Next.js middleware 做鉴权。**延后:`withAdmin()` 的逐处理器包装是显式的,
且无需起服务器即可单测;后台 UI 落地后仍可叠加 middleware。

**只用 Server Actions(不建 REST)。**落选:会把能力永久绑死在 React 客户端上;
V4/V5 的 Hermes/AI 引擎集成明确需要纯 HTTP 契约。

**现在就做 Cookie 会话鉴权。**延后:尚无用户体系(V6);在此之前,共享的
运营者令牌是最小且诚实的机制。

## Consequences

收益:所有管理能力都能以机械的错误语义走 HTTP 触达,并且可以进程内直测;
后台 UI 得以成为薄客户端。代价:API 的安全完全取决于 `ADMIN_TOKEN` 的保密——
生产环境必须设置强值或干脆停用;zod schema 与 core 各自维护一份字段约束,
两层必须同步演进。
