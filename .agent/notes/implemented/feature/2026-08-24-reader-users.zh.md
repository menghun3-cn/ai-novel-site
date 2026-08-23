# Agent Note: 读者账号与会话

Status: implemented

English | [中文](2026-08-24-reader-users.md)

## Problem

公开阅读站(V2)只有匿名访问:没有账号,路线图 §9 的个性化(书架/历史/收
藏/订阅)无处附着。管理端已有鉴权,但那是单一共享令牌——与公众自助注册的
形态完全不同。

## Decision

`core/src/reader.ts`,两张表,零新增依赖:

- **users**——`username` 与 `email` 均 `UNIQUE COLLATE NOCASE`(各自一个
  大小写不敏感命名空间),`password_hash`。校验:用户名 2-24 字符
  (`[\u4e00-\u9fa5A-Za-z0-9_]`,中文用户名可用)、邮箱正则、口令 ≥8。
  违规抛新的通用 `INVALID_INPUT`(400);冲突抛 `USERNAME_TAKEN` /
  `EMAIL_TAKEN`(409)。
- **sessions**——64 位 hex 不透明令牌(32 随机字节),30 天 TTL,随 users
  `ON DELETE CASCADE`。`getSessionReader(token)` 联表查询,未命中时顺手清
  扫过期行。无效/过期 → `SESSION_EXPIRED`(401)。

口令哈希用 node:crypto 的 **scrypt**(默认参数、16 字节盐、64 字节密
钥),存储格式 `scrypt:salt:key`;校验走 `timingSafeEqual`。`loginReader`
接受用户名或邮箱;账号不存在时也跑一次哑 scrypt,避免响应时序泄露账号存
在性。注册成功即返回可用会话(免二次登录),符合现代注册体验。

验证:`npm run test:reader`——15 项断言:校验边界、两字段大小写不敏感唯
一、双标识登录、错口令与幽灵账号路径、登出失效与幂等、伪造令牌、惰性过
期清扫。

## Alternatives considered

**bcrypt/argon2 包。**暂不用:原生依赖破坏零安装故事;scrypt 在 Node 核心
里且同属 KDF 家族。将来若需超出默认的可调内存硬度再议。

**JWT 替代服务端会话。**失去即时吊销与登出保证;会话只是一次有索引的行查
询,而且我们本就常驻 SQLite。

**OAuth/魔法链接。**对 §9 是范围蔓延;普通凭据已满足。邮箱验证是自然的后
续(schema 已有唯一邮箱可承接)。

## Consequences

收益:V6 个性化有了真正的身份原语;管理令牌保持独立,继续作为运维机密。
代价:scrypt 刻意吃 CPU(每次约 50-100ms)——人类注册/登录频率无碍,切勿
在循环里调用;会话只能按令牌吊销(还没有「全端下线」);邮箱明文存储(它
是登录标识,哈希化会破坏该功能)。
