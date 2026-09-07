# Agent Note: README 截图章节与 screenshot.md 索引

Status: implemented

English | [中文](2026-09-07-readme-screenshots.zh.md)

## Problem

仓库 README 记录了架构、功能矩阵、部署与命令,但**没有任何可视化呈现**:
没有展示读者站和管理后台实际样子的截图。与此同时 `screenshot/` 目录已积累
12 张 PNG 截图,既无索引也无从 README 进入的入口,访客不克隆并运行项目
就无法了解产品长什么样。

## Decision

在 `README.md` 顶部(简介表格之后)新增 `## 截图` 章节,只并排嵌入
`screenshot/1.png` 与 `screenshot/5.png`(`width="49%"`,居中)——一组精选
配图,保持 README 轻量。图片正下方一行链接指向新建的 `screenshot.md`,
它是罗列**全部**截图的权威索引:`screenshot/1.png` … `screenshot/12.png`,
以两列表格(`序号 | 截图`)呈现。所有资源仍放在仓库根目录的
`screenshot/` 下,两个文件均以相对路径 `screenshot/<n>.png` 引用。

后续规则:README 章节只展示精选的两张;新增截图一律放入 `screenshot/`
并在 `screenshot.md` 中登记,只有被刻意挑选时才提升进 README 章节。

## Alternatives considered

**把全部 12 张截图直接嵌入 README.md。** 否决:README 已经很长(架构图、
功能矩阵、部署、环境变量);12 张通栏大图会喧宾夺主并拖慢 GitHub 渲染。

**将截图托管到外部(如图床)再链接。** 否决:外部托管可能失效,也破坏
离线/自托管阅读;资源留在仓库内与仓库自包含的文档风格一致。

**在 README 放一行可点击缩略图,分别链接每张图。** 否决:标记复杂度
增加但收益有限;两张图嵌入 + 一个索引文件更易维护。

## Consequences

- README 现在先给读者视觉第一印象(1.png、5.png),并有明确的
  「更多截图」跳转到 `screenshot.md`。
- `screenshot.md` 是所有截图的唯一清单;新增截图只需在表格里加一行。
- 12 张 PNG 资源(共约 1.9 MB)提交进仓库:略微增大克隆体积,但文档
  自包含,并与其展示的界面一同受版本管理。
- 截图是静态快照:在有人重新截图并更新文件之前,可能落后于当前界面。
