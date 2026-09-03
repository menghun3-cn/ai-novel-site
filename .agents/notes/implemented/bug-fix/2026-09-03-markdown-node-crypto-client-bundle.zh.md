# Agent Note: Markdown cache key must not depend on node:crypto — client bundling fails

Status: implemented

English | [中文](2026-09-03-markdown-node-crypto-client-bundle.zh.md)

## Problem

`web/lib/markdown.ts` 从 `node:crypto` 引入 `createHash` 来生成渲染 HTML 的内容寻址缓存键。该模块同时被服务端页面(`(site)/books/[slug]/chapter/[number]`、`(site)/short/[id]`)和客户端组件 `app/admin/(dash)/works/[id]/page.tsx` 引用——后者在浏览器里调用 `mdToHtml()` 实现「渲染预览」。

`next build` 时,webpack 会把这个页面用到的 `markdown.ts` 打进客户端 bundle,然后报错:

```
UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins
```

`node:` scheme 在浏览器 bundle 中无法解析,生产构建(以及每一次部署)因此编译失败。

## Decision

从 `web/lib/markdown.ts` 彻底移除 `node:crypto` 依赖:

- 缓存键改为**确定性纯 JS 哈希**:两路相互独立的 32 位 FNV-1a(种子分别为 `0x811c9dc5` 与 `0x9e3779b9`)拼接成一个 64 位十六进制串。
- 同一份代码在服务端与浏览器行为完全一致,模块可继续共享,无需按环境分叉。
- 缓存契约不变:同一内容 → 同一键;内容被编辑 → 新键 → 缓存 miss → 重新渲染。对 ≤1000 条 LRU 条目,作为缓存键的碰撞概率可忽略;该哈希不用于安全目的。

代码库中其余 `node:` 导入(`admin-api.ts`、`admin-media.ts`、`api/tts/route.ts`)只被服务端 route handler 可达,不会泄漏进客户端 bundle,保持原样。

## Alternatives considered

**保留 `node:crypto`,另加 webpack fallback / externals 配置。**
否决:只是在一个点绕过症状,模块仍然环境相关;未来任何客户端调用方都需要同样的逃生门。移除依赖是从构造上保证安全。

**复制一份仅服务端的 markdown 模块,经 API route 调用。**
否决:预览功能本就合理地在浏览器渲染;拆分会引入 API 往返,并且同一逻辑要维护两份。

**改用 `crypto.subtle`(WebCrypto)。**
否决:`digest()` 是异步的,会让 `cacheKey` 和缓存查询被迫变异步,没有收益;缓存键不需要密码学强度,只需要确定性。

## Consequences

- `next build` 恢复可编译;已在本地完整跑通生产构建(`npm run build -w web`),退出码 0。
- admin「渲染预览」依旧完全在客户端渲染 markdown,行为不变。
- 缓存键格式变化(sha256 hex → FNV-1a 64 位 hex);进程内 LRU 只以内容为键,不涉及持久化数据或线上契约。
- 服务端与客户端行为一致,该模块不会再出现环境相关的分叉。