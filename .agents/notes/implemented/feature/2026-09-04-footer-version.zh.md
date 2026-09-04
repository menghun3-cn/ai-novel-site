# Agent Note: 用户端页脚显示应用版本号

Status: implemented

English | [中文](2026-09-04-footer-version.zh.md)

## Problem

用户端页脚只渲染版权行——`© <年份> 云燕阅读 · AI小说创作平台`,不含任何版本
信息。用户在反馈问题时无法说明自己用的是哪个构建;而管理端外壳
(`AdminShell.tsx`)已经显示 `v<package.json 版本>`,用户端与之不一致。

## Decision

在用户端页脚版权行后追加应用版本号,与管理端外壳一样取自
`web/package.json`:

```tsx
<span>
  © {new Date().getFullYear()} 云燕阅读 · AI小说创作平台
  <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500" title={`版本 ${appPackage.version}`}>
    v{appPackage.version}
  </span>
</span>
```

- 版本号在构建期通过 `import appPackage from '../package.json'` 读取
  (服务端组件;`resolveJsonModule` 已开启,与 `AdminShell.tsx` 同一模式),
  发布时升级版本号会自动流入页脚。
- 版本号以弱化样式(`text-xs`、浅色)显示在版权文字之后,带 `title` 提示
  「版本 <版本号>」,与管理端外壳的 `vX.Y.Z` 格式一致。

## Alternatives considered

**在页脚硬编码版本字符串。** 否决:每次升级都会与真实的 `package.json`
版本脱节;构建期导入保持单一数据源。

**通过 API 或运行时环境变量读取。** 否决:静态值无需往返请求;
package.json 导入已是本仓库既有模式。

## Consequences

- 读者现在可以从页脚报告精确构建版本(本次改动时为 `v8.3.1`),与管理端
  外壳的版本显示一致。
- 页脚保持服务端渲染组件;未引入客户端请求或状态。
- 后续发布升级(如 8.3.1 → 8.3.2)重建后自动反映;已缓存页面的 ISR 60s
  缓存窗口可能延迟更新。
