# Agent Note: 用户端分类浏览折叠与「小说」标题去重

Status: implemented

English | [中文](2026-09-04-category-browser-collapse-and-title.zh.md)

## Problem

用户端分类浏览有两个体验缺陷。

(1) **「全部小说」页分类一次性全展开**。`BooksBrowser` 把
`listCategories()` 返回的全部分类(默认种子约 78 个题材,加上短篇发布自动
upsert 的分类)全部渲染成 chips,一行排不下、页面被几十个按钮占满,用户难以
聚焦真正有书的「主要」分类,也没有任何展开/收起交互。

(2) **分类详情页标题文案重复**。`CategoryBrowser` 的 `<h1>` 与
`/categories/[slug]` 的 `generateMetadata` title 都固定拼接
`{cat.name}小说`。当分类名本身以「小说」结尾(典型如短篇发布管线自动创建的
「短篇小说」分类)时,页面标题变成「短篇小说小说」,浏览器标签页同样重复。

## Decision

- **BooksBrowser 折叠分类 chips**:默认只展示按书籍数量降序排序的前
  `MAIN_CATEGORY_LIMIT = 8` 个主要分类;末尾增加虚线边框的
  「展开全部/收起」切换按钮(带 ChevronDown/ChevronUp 图标)展示/隐藏其余
  分类。当前通过 URL 选中、但不在前 8 名的分类仍保持可见,避免选中后 chip
  消失。「全部」chip 与总计数逻辑不变,筛选行为零变化。
- **分类标题去重**:`CategoryBrowser` 的 `<h1>` 与
  `/categories/[slug]` 的 `generateMetadata` 改为条件拼接——分类名以
  「小说」结尾时直接使用原名(「短篇小说」→「短篇小说」),否则追加「小说」
  (「科幻」→「科幻小说」)。`kind` 筛选、计数与书籍网格不受影响。

## Alternatives considered

**BooksBrowser 只显示计数 > 0 的分类,不提供展开。** 否决:会隐藏所有暂无
书籍的分类,与「全部」chip 的总数语义脱节,也无法浏览空分类(管理员准备
上架新题材时的入口);折叠 + 展开保留了完整入口,同时默认界面更干净。

**BooksBrowser 默认展开、仅加「收起」按钮。** 否决:与问题描述(默认
一次性全展开造成拥挤)相反,不能改善首屏。

**分类标题统一不再拼接「小说」。** 否决:大多数分类名是纯题材词(科幻、
玄幻、都市……),去掉后缀会让「科幻」这样无上下文的词单独作标题,反而
损失了「科幻小说」的语义清晰度;条件拼接同时满足两类分类名。

## Consequences

- 「全部小说」页首屏从几十个分类 chip 收敛到 8 个主要分类 + 一个切换按钮,
  有书的分类按数量优先展示;展开后仍可浏览全部分类,功能无损。
- 「短篇小说」等以「小说」结尾的分类,详情页标题与浏览器标签页不再出现
  「短篇小说小说」的重复文案;普通题材分类标题保持不变。
- 纯客户端状态(`catsExpanded`)驱动折叠,不触碰 ISR/服务端渲染路径,
  `?kind=`/`?category=` 初始筛选与零服务端往返的既有决策不受影响;
  沿用 [user-categories-and-list-performance](../feature/2026-09-04-user-categories-and-list-performance.md)
  确立的 BooksBrowser/CategoryBrowser 客户端筛选边界。
