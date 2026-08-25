# Agent Note: 读者认证界面

Status: implemented

English | [中文](2026-08-24-reader-auth-ui.md)

## Problem

PR31 的读者账号只是库函数,没有 HTTP 与 UI:路线图的 登录/注册 两个入口无
处可去,站点头部队也无法反映当前读者是谁。

## Decision

四条公开路由 + 两个页面 + 一个头部组件:

- **`POST /api/auth/register|login`**——zod 校验,委托 core 服务,响应
  `{user, expiresAt}` 并下发 `reader_session` HttpOnly SameSite=Lax
  Cookie(30 天)。错误走共享的 admin `handleError` 映射(USERNAME_TAKEN→409、
  INVALID_CREDENTIALS→401…)。**Secure 标志改为显式开启**
  (`READER_COOKIE_SECURE=1`)——默认关闭,纯 HTTP 自托管部署才不会悄悄丢登
  录 Cookie。
- **`POST /api/auth/logout`**——删服务端会话(幂等)并以 Max-Age=0 清 Cookie。
- **`GET /api/auth/me`**——恒 200;匿名返回 `{user:null}`,客户端探测状态
  无需错误处理。
- **/login · /register 页面**——单列表单,沿用站点的 neutral/sky 语言:可见
  label、密码 显示/隐藏 切换、autocomplete 提示、填全才可提交、行内
  role="alert" 友好文案(错口令→用户名或密码不正确;重名→用户名已被占用),
  两页互链。成功先派发 `reader:changed` 窗口事件再路由(login→/、
  register→/shelf)。
- **Header 内 ReaderMenu**——客户端组件:匿名渲染 登录/注册;已登录渲染
  书架 + 用户名(→/me) + 退出。(site) 布局在客户端导航中存活,登录后若不重
  挂载菜单会滞留旧身份,故监听 `reader:changed` 重拉 /me。随本 PR 落一个最
  小 /shelf 占位页(未登录提示 vs 即将上线),让注册后的跳转有真实去处;
  PR34 替换为完整实现。

验证:test:reader-api 17 项断言,用真正的 NextRequest 直调处理器(普通
Request 没有 `.cookies`,`currentReader` 会静默变 null——被 me-with-cookie
断言当场抓住):校验、重名 409、Set-Cookie 形态、邮箱登录、错口令、登出清
除与旧令牌失效。CDP 审计 7/7:页面渲染、匿名头、表单范围、注册→/shelf 且
头部翻转为 书架/用户名/退出、登出恢复 登录/注册、错口令行内告警。

## Alternatives considered

**服务端组件读 Cookie 渲染菜单。**省掉事件,但 Header 得到处
router.refresh() 还会闪烁;每次挂载一次微型客户端探测更简单,且浏览器标签
页内自带缓存。

**用 Middleware 守卫 /shelf。**书架还不存在,过早;客户端提示让 PR32 自洽。

## Consequences

收益:完整凭据闭环端到端跑通,零整页刷新;身份原语经头部队对每页可达。代
价:`reader:changed` 是隐式契约,后续任何改认证面的代码都要记得派发(已在
此记录);Cookie 默认非 Secure——TLS 部署应设 READER_COOKIE_SECURE=1;
/shelf 在 PR34 前是占位。
