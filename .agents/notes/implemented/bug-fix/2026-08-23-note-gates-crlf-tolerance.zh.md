# Agent Note: Note gates CRLF tolerance and LF-pinned checkout

Status: implemented

English | [中文](2026-08-23-note-gates-crlf-tolerance.md)

## Problem

在 Windows 且 `core.autocrlf=true` 的环境下,每次切换分支都会把工作区中被
跟踪的 Agent Note 与门禁脚本改写成 CRLF。格式门禁按 `\n` 切分文件内容,
每行末尾残留 `\r`,于是任何笔记只要被重新检出,门禁就报「line 2 must be
blank」/状态语法错误——写入时全绿,下一次 `git checkout` 即碎(首次发现于
PR #2 验证时,采纳门禁仅数分钟)。`scripts/archived-agent-notes.ts` 中的
归档笔记头部解析器与双语配对记录解析器有同样缺陷;而字节级封存 hash
(sha256 / git blob)一旦被 EOL 改写波及就会漂移。

## Decision

三处读取笔记文本的行解析全部改为 CRLF 容忍:`scripts/verify-agent-note-format.ts`
按 `/\r?\n/` 切分,`scripts/archived-agent-notes.ts` 的 `pairMeta` 与
`validateHeader` 同样处理。hash 计算刻意保持字节精确——容忍只作用于语法,
绝不作用于封存内容的同一性。仓库根新增 `.gitattributes`,钉住
`* text=auto eol=lf`(外加常见二进制类型守卫),使检出的字节不受
`core.autocrlf` 影响;工作区通过 `git add --renormalize .` 加
`git checkout-index -f -a` 做了一次性重归一化。

## Alternatives considered

**要求贡献者本地设置 `core.autocrlf=false`。**落选:克隆级配置无法由仓库
强制执行,门禁必须在每一个现有与未来的克隆上都成立。

**比较前裁掉 `\r`/行尾空白。**落选:会削弱成文的格式契约(空行是有意义的
结构);容忍应当精确且仅存在于 EOL 边界。

**只加 `.gitattributes` 不改门禁。**落选:编辑器随时可能把 CRLF 存回工作
区文件;门禁不能依赖属性恰好已应用到当前工作区。

## Consequences

收益:Windows 优先的开发不再与自己的工具链缠斗——门禁在切换分支、编辑器
保存、全新克隆之后都保持绿色;封存 hash 因字节不再随 EOL 改写而保持稳定。
代价:整树钉死为 LF(一次性重归一化);未来新增二进制资产必须登记进
`.gitattributes`,否则 git 的文本侦测可能损坏它们。
