# Agent Note: 后台 LLM 设置

Status: implemented

English | [中文](2026-08-23-admin-llm-settings.md)

## Problem

LLM 凭据只存在于环境变量:换网关要改用户/机器级环境变量并重启进程,运营者
看不到当前配置,也没法不靠 curl 验证连通性。运营者控制台需要一个运行时可
配的 AI 服务。

## Decision

三块:

1. **存储**——新 `app_settings` 键值表(DDL `IF NOT EXISTS`,免迁移)加
   `core/src/settings.ts`:`getLlmSettings()` 返回公开视图,API Key 只以
   `apiKeyConfigured` + `apiKeyPreview`(`sk-…wxyz`,首 3 尾 4)出现;
   `getLlmSecretConfig()` 仅服务端合并时暴露明文;`setLlmSettings(patch)`
   约定 `undefined` = 不变、`null`/空串 = 清除。
2. **解析器泛化**——ai-writer 的 env 解析器改为
   `resolveProvider({baseUrl, apiKey, model})`;`resolveProviderFromEnv`
   保留为薄壳。生成路由逐字段按**后台设置优先、环境变量回退**合并,因此
   半填的后台配置(比如只填 URL+Key、模型留空走自动发现)依然可用。模型发
   现缓存仍按 baseUrl+apiKey 键控。
3. **UI 与端点**——`/admin/settings`(**系统设置**,侧栏 Settings 图标入口):
   Base URL 输入、密码式 API Key 输入(已配置时 label 显示掩码,留空=保持)、
   可选模型输入,以及两个动作——保存配置 和 测试连通。测试端点与生成完全同
   法合并配置,必要时先发现模型,再发一次最小补全,返回 `{ok, model,
   sample}` 或 `{ok:false, code, message}`。页面徽章标明当前生效来源(后台
   配置 vs 环境变量回退)。

本 PR 另含一项(外观类但被要求):侧栏品牌块在名称下显示应用版本号,取自
`web/package.json`(v4.0.0),部署产物可自我标识。

验证:`npm run test:settings`(12 项断言:空默认值、掩码形状、部分更新与清
除语义、明文仅内部可见、解析器守卫、mock 上游上经 DB 配置的发现+补全、清
空后回退环境变量)。CDP 审计 12/12:导航入口、品牌下版本号、表单回填、保
存往返、配置后的掩码标签、跨刷新持久化、以及在服务器进程**完全无 AI_* 环
境变量**的前提下 测试连通 经存储配置全链路成功。最后用用户提供的真实网关
做了冒烟:发现选中第一个可用模型,真实补全返回。typecheck 与生产构建全绿。

## Alternatives considered

**只用环境变量。**落选:每次变更都要重启且运营者零可见性;用户明确要求在
控制台管理。

**静态加密 Key。**延后:SQLite 文件本就受 OS 文件权限保护;对称加密只会把
秘密挪到另一个环境变量里。若部署形态演进为多租户存储再议。

**单独的模型发现端点。**并入 测试连通:一个动作同时回答"凭据对不对"和"会
用哪个模型",这才是运营者真正想知道的。

## Consequences

收益:换网关变成改一次表单点一下按钮、即刻可验证;本地开发也不再依赖机器
级环境变量。代价:API Key 以明文存在 `data/novel.db` 里——单运营者部署且
该库本就持有全部内容时可接受,但意味着 **DB 备份现在包含凭据**(请相应对
待);另外生成路由每次请求读两次设置(有索引的点查,此规模无可测成本)。
