# Agent Note: Media management with sandboxed public serving

Status: implemented

English | [中文](2026-08-23-admin-media-management.md)

## Problem

路线图的媒体管理模块(封面、作者头像、插图、网站资源)此前没有任何存储与
上传通道:`cover_path`/`avatar_path` 列只能靠人工粘贴字符串,也没有任何 URL
能取到二进制资源。管理 API([相关](../feature/2026-08-23-admin-api-token-auth.md))
需要上传端点,让封面和头像变成浏览器可达的真实文件。

## Decision

媒体以扁平文件存放在 `data/media/`,目录经 `path.dirname(getDbPath())`
定位——数据目录只有一个事实来源(随 `NOVEL_DATA_DIR` 可迁移,
且已被 `data/*` gitignore 覆盖)。

`web/lib/admin-media.ts` 是守门人:文件名必须完全匹配
`[A-Za-z0-9._-]{1,120}` 且扩展名在白名单内(png/jpg/jpeg/webp/gif/svg);
含路径分隔符或 `..` 的名字**显式拒绝**,绝不静默改写;空文件与超过 5 MiB
的文件被拒(`EMPTY_MEDIA` / `MEDIA_TOO_LARGE` → 400 / 413);重名返回
`MEDIA_NAME_TAKEN` → 409,保证名字永远对应不可变内容。
`web/app/api/admin/media/route.ts` 提供列表(`GET`)与上传(`POST`,
multipart `file` 字段,可选 `name` 覆盖);`.../[name]/route.ts` 删除;
失败经 `withAdmin` 错误映射流出(现已识别 `MediaError`)。

公开服务是 `web/app/media/[...path]/route.ts`:只允许单段文件名、按扩展名
映射内容类型、`Cache-Control: public, max-age=31536000, immutable`
(名字唯一),并且每个响应都带
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
sandbox` 头——上传的 SVG 无法在本站源上执行脚本。

验证:`npm run test:media` 对临时目录覆盖上传正常路径、扩展名白名单、
穿越拒绝、重名 409、大小上限 413、缺字段 400、列表、逐字节公开服务与响应头、
404 与删除,共 14 项。

## Alternatives considered

**数据库 BLOB 存媒体。**落选:低频读取的二进制会撑爆 SQLite 备份,还让流式
响应/缓存头变复杂;放在既有数据目录下保持备份语义不变。

**把恶意名字静默压成 basename。**在本特性修测试时落选:`../../evil.png`
变成 `evil.png` 安全但出人意料;显式拒绝让运营者意图保持可见。

**现在就接 S3/OSS 对象存储。**延后:本地磁盘契合当前单机 Docker 部署;
`/media/*` 的 URL 契约在日后迁移到对象存储时依然成立。

**SVG 不加 CSP 直接服务。**落选:同源 SVG 会执行脚本,任何上传者都能变成 XSS;
sandbox 策略让 SVG 只能作为图片使用。

## Consequences

收益:封面/头像拥有端到端链路(上传 → URL → 字段列),服务路径穿越安全,
媒体随数据目录整体可迁移。代价:扁平命名空间暂无按书组织;删除媒体文件不会
清理指向它的引用——后台 UI 必须把 `cover_path` 值当作软引用对待,
直到出现清理环节。
