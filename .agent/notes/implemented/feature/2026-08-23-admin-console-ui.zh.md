# Agent Note: Admin console UI with route-group shell split

Status: implemented

English | [中文](2026-08-23-admin-console-ui.md)

## Problem

V2 的六个管理模块已有完整服务层与 REST API
([相关](2026-08-23-admin-media-management.md)、[相关](2026-08-23-admin-book-chapter-management.md)),
但没有面向运营者的界面:封面、章节、标签只能靠手工调用 HTTP 端点管理。
根布局还把阅读站的 Header/Footer 硬套在所有路由上——`/admin` 页面会继承公共站外壳。

## Decision

用 Next.js 路由组拆分应用:所有公开页移入 `app/(site)/`,由
`(site)/layout.tsx` 承载 Header/Footer;根布局只保留 `html`/`body`。
URL 不变,`next build` 中公共路由产物不变。

控制台位于 `app/admin/`,分两个壳层。`/admin/login` 是独立的居中卡片
(400px),录入 `ADMIN_TOKEN`,调用真实端点校验后存入 localStorage。
`app/admin/(dash)/` 用 `AdminShell` 包住其余所有页面——逐字落地 LSG
企业级规格:200px/64px 可折叠侧栏带选中指示条、56px 深蓝渐变顶栏、
`#eef4fb` 画布、40px 菜单项、16px 内容区留白。`AdminShell` 在挂载时守卫
登录态(无令牌或 401 → 跳转登录),并持久化折叠状态。

共享原语在 `components/admin/ui.tsx`(primary/secondary/ghost/danger 四种
按钮及完整 hover/focus/disabled 态,可见 label 与就近错误的表单字段,
状态徽章,弹窗 + 420px 危险确认框含 ESC/遮罩关闭,空状态,反馈条)和
`lib/admin-client.ts`(令牌存取、附加 `x-admin-token` 的 fetch 封装、错误
归一化、401 自动清除)。页面为客户端组件:渐变 KPI 卡概览、带搜索/筛选/
隐藏/删除与新建弹窗的小说表格、小说详情(元数据表单 + 章节表格——新建/
编辑弹窗承载 draft/scheduled/published 语义、上下移经 `PUT order` 重排、
守卫删除)、作者、分类、标签,以及上传/复制地址/删除的媒体网格。

验证采用 CDP 驱动的浏览器审计(`.verify-admin-ui-data/` 工具,不入库):
先经真实 API 造数据,再驱动 headless Edge 断言 32 项结构/样式/响应式检查
——壳层尺寸与渐变像素、徽章渲染、筛选交互、375px 抽屉与表内横滚、媒体经
`/media` 加载、1440/375 双端零横向溢出。`next build`、`typecheck` 与三套
API 测试全绿;路由组迁移后公共站六条冒烟路由均 200。

## Alternatives considered

**用中间件做 `/admin` 鉴权重定向。**落选:令牌只存在 localStorage,服务端
中间件读不到;客户端守卫让密钥留在浏览器侧,API 仍是真正的执法点。

**在后台复用阅读站 Header/Footer。**落选:消费者外壳与运营控制台混装,
且破坏固定壳层滚动模型(body 不再滚动,各区域独立滚动)。

**引入组件库(shadcn/antd)。**延后:控制台只需约 10 个原语且要精确落实
LSG 数值;手写 Tailwind 保持依赖树扁平、规格逐字可查。日后组件库可在不动
页面的前提下替换原语。

**仅凭截图做视觉验收。**本轮落选:视觉服务不可用(403),改以 DOM/样式
审计加顶栏渐变像素取色——确定性强、可重放,但无法评判美学。

## Consequences

收益:运营者可用一个令牌在浏览器里跑通 V2 全部界面(书籍/章节/作者/分类/
标签/媒体);公开页与控制台外壳彻底隔离。代价:localStorage 中的令牌对同源
XSS 可读——在控制台同源且仅运营者使用的前提下可接受,若权限范围扩大,
HttpOnly Cookie 会话是升级路径。章节弹窗交互未在浏览器中端到端驱动;
其逻辑已由 API 测试套件覆盖。
