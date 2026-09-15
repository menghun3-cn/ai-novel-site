# Agent Note: Edge TTS 切换为 OpenAI 兼容云端封装

Status: implemented

[English](2026-09-15-edge-tts-openai-compatible-api.md) | 中文

## Problem

听书 `edge` 引擎原本由服务器直连微软 Bing 语音 WebSocket:
`web/lib/edge-tts.ts` 计算 Sec-MS-GEC 令牌,
`web/app/api/tts/route.ts` 从
`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`
逐块接收 base64 音频。该路径很脆:令牌算法与端点持续漂移、微软端口常被
防火墙拦截(生产主机一直连不通),也没有可控的契约可以钉死。上游
ai-edge-tts2api 项目提供维护中的 OpenAI 兼容 HTTP 封装
(`POST /v1/audio/speech`,Bearer 鉴权,返回裸 `audio/mpeg`),在服务端处理
音色、分块、并发与令牌;用户要求把本仓库 edge 引擎切换到该方案。

## Decision

用一次 HTTP POST 到 ai-edge-tts2api 的 OpenAI 兼容端点,替换 bing WebSocket:

- `web/app/api/tts/route.ts` 的 `synthesizeEdge(text, voice, speed)` 现在只做
  一次 `fetch(EDGE_TTS_API_URL)`,带 `Authorization: Bearer ${EDGE_TTS_API_KEY}`,
  请求体 `{ model: 'tts-1', input, voice, speed, response_format: 'mp3' }`,
  30 秒 `AbortController` 超时,把裸 `audio/mpeg` 原样代理给浏览器。
- `EDGE_TTS_API_URL` / `EDGE_TTS_API_KEY` 从环境变量读取;缺省端点为
  `https://edgetts2api.menghun3.cc/v1/audio/speech`(自定义域名,V10.8 起为
  默认——ai-edge-tts2api README 的 `*.workers.dev` 端点在境内网络被 DNS
  污染),缺省密钥为共享部署密钥;密钥只在服务端路由读取,不进共享客户端代码。
- 删除全部 bing 专属逻辑:Sec-MS-GEC 计算、WSS 地址、UA、`parseAudioChunk`、
  `buildEdgeSSML`,以及 `EDGE_TTS_PROXY` 环境变量(`docker-compose.yml` 与
  README 改为 `EDGE_TTS_API_URL`)。
- 前端错误映射:401 → 鉴权失败提示,`AbortError` → 超时,`TypeError` →
  无法连接(前端追加「可改用 Kokoro 本地语音」提示),非 2xx → 透传上游
  `error.message`。
- `GET /api/tts` 可用性探测现在恰好返回 `{"engines":["edge","native"]}`;
  `kokoro` 引擎已在 V10.8 移除(见
  [edge-tts-custom-domain-kokoro-removal](../../implemented/simplification/2026-09-15-edge-tts-custom-domain-kokoro-removal.zh.md))。

## Alternatives considered

- **保留并修补 bing WebSocket 客户端。** 否决:它本就是最脆的部分(令牌算法
  漂移、端点/防火墙不稳定);封装把这份维护移出了本仓库。
- **自托管 edge-tts npm 包做代理。** 否决:token/WS 表面不变、只是换地方;
  用户明确要求 ai-edge-tts2api 的 HTTP 契约。
- **双通道传输(先 WS 后 HTTP 回退)。** 否决:为过渡态加倍表面积;引擎级
  回退矩阵(edge → kokoro)已覆盖不可用场景。

## Consequences

- edge 引擎需要出站 HTTPS 访问端点;V10.8 起默认为自定义域名
  `https://edgetts2api.menghun3.cc`,工作区与生产主机(境内)均可直连:已从
  生产主机实测 `GET /v1/models` 200、`POST /v1/audio/speech` 200 → 约
  20.7 KB `audio/mpeg`。README 的 `*.workers.dev` 主机在境内仍然不可达
  (DNS 劫持 + SERVFAIL,TCP 443 不通)。
- 共享 API 密钥是 ai-edge-tts2api README 中公开的活凭据;部署可用
  `EDGE_TTS_API_KEY` 覆盖。服务器环境变量无需改动即可生效。
- 版本 8.3.8 → 8.3.9(V10.7.7);CHANGELOG [Unreleased] 记录了引擎切换与验证
  (typecheck、next build、`test:tts-reader` 13/13、mock 上游 e2e)。
- 交叉引用:
  [user-categories-and-list-performance](../../implemented/feature/2026-09-04-user-categories-and-list-performance.zh.md)
  中的传输描述已就地更新(edge 现在是发往封装的 HTTP POST,不再是 bing
  WebSocket);
  [local-kokoro-tts](../../archived/feature/2026-09-03-local-kokoro-tts.zh.md)
  (含同样的传输更新)随 V10.8 kokoro 移除一并归档。
