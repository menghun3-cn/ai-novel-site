# Agent Note: 用户端按题材动态生成书本封面

Status: implemented

English | [中文](2026-09-04-reader-dynamic-covers.zh.md)

## Problem

没有上传封面(`coverPath` 为空——AI 生成的短篇全部如此,运营没给配图的
长篇也一样)的书,在读者站各处只显示一个首字占位块。首页 / 全部小说 /
搜索 / 热门榜满屏都是这种书时,一排卡片就是一面灰块墙:既单调,读者打开
书之前也得不到任何题材信息。参考封面设计(300×400,书脊 + 水彩 + 竖排
书名 + 状态徽标 + 书签绳)证明「书」这个隐喻成立,但全站一套配色只会把
单调换一个形状继续存在。

## Decision

新增一个零依赖、服务端渲染的 SVG 封面生成器,并把它接成读者站所有封面
位的兜底:

- **`web/lib/cover-svg.ts`** —— 纯字符串拼接(不引框架,verify 脚本可
  直接 import)。保留参考「书」骨架(带 AI + 题材字的书脊、封面、页边
  纹理、书签绳、投影),并按题材改变**配色、装饰母题、字体与标题排布**:
  heal(治愈)/ scifi(科幻)/ xianxia(仙侠)/ mystery(悬疑)/ romance
  (言情)/ urban(都市)/ campus(校园)/ history(历史)/ adventure(冒险)/
  default(默认),按书名分类关键词匹配(未命中回退 default)。纯中文书名
  竖排(最长 10 字,字号自动缩放,居中排布保证不压状态徽标);含拉丁/
  数字的书名横排并按词换行不腰斩单词。作者、状态徽标(短篇/连载中/完结)、
  「分类短篇 · 共N章」页脚与参考稿布局一致。所有文本做 XML 转义。
- **48×48 小图标变体**(`renderCoverIconSvg`),给列表行用——最新更新与
  热门小说排名行渲染圆角底板 + 书脊 + 水彩色块 + 题材小母题 + 题材字,
  而不是把 300×400 大封面缩成看不清的缩略图。
- **`web/app/api/covers/[slug]/route.ts`** —— 以 `image/svg+xml` 返回,
  带媒体路由同款 CSP(`default-src 'none'; style-src 'unsafe-inline';
  sandbox`)与 `public, max-age=3600, stale-while-revalidate=86400`。
  书有真实封面时 307 重定向到原图(运营上传的图保持权威);隐藏/不存在的
  书 404(与读者端所有查询同一套公开可见性口径)。`?s=icon` 选 48×48
  变体。
- **接线。** `coverSrc`/`coverIconSrc` 统一封面路径(带前导斜杠原样保留,
  相对路径补斜杠),无封面时回退到该 API 路由。应用到 BookCard、
  DiscoveryCard、HotRanking(排名行用图标变体,第 1 名主视觉保留完整封面)、
  RecentUpdates(图标)、首页主推、书籍详情、搜索结果——替换所有首字占位。
- **`scripts/verify-cover.ts`**(`npm run test:cover`)——断言各分类的主题
  选择、SVG 结构、XML 转义、URL 兜底,以及路由行为(200 / `?s=icon` /
  307 重定向 / 404 不存在与隐藏)。

## Alternatives considered

**保留首字占位。** 否决:这正是要修掉的单调,且不携带任何题材信息;有
主题的封面同时是浏览信号。

**构建期按分类预生成静态 SVG 文件。** 否决:封面要反映书籍实时状态
(状态徽标、章节数、作者),静态目录要么过期要么每次发布都重建;运行时
生成保持单一事实来源、与部署零耦合。

**一律生成、无视 `coverPath`。** 否决:运营上传的配图是更高质量的权威
封面;路由重定向到它,让已有配图始终优先。

**客户端生成(canvas/JS)。** 否决:服务端 SVG 可缓存、可被 CSP 沙箱
隔离、零依赖,且禁用 JS 时也能显示。

**生成器放 `core/src/`。** 否决,放 `web/lib/`:这是读者站的表现层,
放 web 让 core 保持无表现层负担,同时 verify 脚本仍可直接 import。

## Consequences

- 所有无封面书现在在所有读者端面上都有题材一致的书本形封面;题材主题
  由 `categoryName` 决定。
- AI 生成的短篇以固定分类「短篇小说」发布,不命中任何主题关键词 → 落到
  中性默认主题。若想让它们跟随 story brief 的题材,需要改动
  `core/src/short-story-publication.ts`(分类取 `brief.genre`),刻意不在
  本次范围。
- 封面路由 `force-dynamic` + 1 小时缓存:状态/章节变化后封面最多滞后一个
  缓存窗口。
- `test:cover` 加入验证套件;生成器无运行时依赖,不会引入构建顺序问题。
