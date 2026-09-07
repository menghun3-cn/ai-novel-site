# Agent Note: 用户端页头 GitHub 源码链接

Status: implemented

English | [中文](2026-09-07-reader-header-github-link.zh.md)

## Problem

读者站(`web/app/(site)`)没有指向项目源码的任何链接。仓库地址只存在于
文档(README.md)中,浏览已部署读者站的用户无法触达开源仓库,页头右侧
操作区(ReaderMenu + ThemeToggle)也没有任何外链入口。

## Decision

在读者站页头(`web/components/Header.tsx`)**主题切换按钮右侧**新增 GitHub
图标按钮:一个指向 `https://github.com/menghun3-cn/ai-novel-site` 的普通
`<a>`,带 `target="_blank"` 与 `rel="noopener noreferrer"`。样式与
`ThemeToggle` 一致——9×9 圆角全圆描边按钮、`currentColor` 填充,渲染标准
GitHub 章鱼猫标识(18px),并带 `aria-label` / `title`「源码仓库(GitHub)」。
由于是纯服务端渲染标记、无客户端状态,它在每个读者页面上表现一致。

## Alternatives considered

**只把链接加在页脚。** 否决:需求是右上角、主题切换旁的入口;用户浏览
书籍时页脚不在视野内。

**把链接放进管理后台。** 否决:管理端外壳面向运营人员;需求针对读者端
界面(用户阅读端)。

**用文字链接而非图标。** 否决:页头操作区是图标尺寸(ReaderMenu /
ThemeToggle 均为 9×9 圆形);图标保持整行一致,且章鱼猫标识普适易认。

## Consequences

- 读者点击一次即可到达源码仓库;链接在新标签页打开
  (`target="_blank"` + `rel="noopener noreferrer"`),不会把读者站导航走。
- 页头右侧操作区现为 ReaderMenu → ThemeToggle → GitHub,主题切换相对
  菜单的位置不变。
- 仓库地址硬编码在 `Header.tsx`;若仓库改名或迁移,需同步更新 `href`
  (README.md 已在正文引用同一地址)。
