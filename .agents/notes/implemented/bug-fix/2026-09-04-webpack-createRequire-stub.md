# Agent Note: webpack 打包 createRequire 成 stub 导致线上 kokoro 恒 false

Status: implemented

English | [中文](2026-09-04-webpack-createRequire-stub.zh.md)

## Problem

V10.7.1(v8.3.3)修复 compose 写死 `ENABLE_LOCAL_TTS=0` 后,容器内依赖/语音/模型
全部就绪(`require.resolve('kokoro-js-zh')` 手动执行成功、8 个 voices/*.bin 齐全、
espeak-ng.wasm 存在、onnx/model_quantized.onnx 挂载),但线上
`GET /api/tts` 仍返回 `engines: ["edge","native"]`、`kokoro.available: false`,
`POST engine=kokoro` 仍 503「镜像未启用 ENABLE_LOCAL_TTS,或模型未挂载」。

**根因**:Next.js 生产构建(webpack)把 `createRequire(import.meta.url)` 编译成
永远抛 `MODULE_NOT_FOUND` 的 stub(编译产物 route.js 模块 17331):

```js
17331: a => { function b(a){ var b=Error("Cannot find module '"+a+"'");
  throw b.code="MODULE_NOT_FOUND", b; }
  b.keys=()=>[], b.resolve=b, b.id=17331, a.exports=b }
```

于是 `kokoro-server.ts` 中所有 `require.resolve(...)`(`kokoroPkgDir()`、
`kokoroInstalled()`、espeak-ng.wasm 源定位)在 **Next 运行时一律抛错** →
`kokoroAvailable()` false → 前端探测不到 kokoro 引擎。

**为何本地测试通过**:`test:tts-reader`/`test:tts-local`/`rebuild.sh` 容器内验证
都是直接跑 tsx/TS 源码,不经 webpack 打包,createRequire 行为正常;
只有 Next.js 生产 bundle 才触发 stub 化——「本地绿、线上挂」的典型差异。

**为何动态 import 不受影响**:`getTTS()` 用 `import(/* webpackIgnore: true */ ...)`,
webpack 原样保留为运行时动态 import(编译产物中确为 `await import(F)`),
运行时由 Node 自身解析,可正常加载 kokoro-js-zh。

## Decision

`kokoro-server.ts` 的包路径探测**废弃 createRequire/require.resolve**,
改用文件系统从 cwd 向上逐级探测:

- 新增 `findNodeModulesDir(pkgName)`:从 `process.cwd()` 起,每级检查
  `node_modules/<pkg>/package.json` 是否存在,向上直到根目录;
- `kokoroPkgDir()` / `kokoroInstalled()` 改用 `findNodeModulesDir('kokoro-js-zh')`;
- `ensureRuntimeAssets()` 中 espeak-ng.wasm 源定位改用
  `findNodeModulesDir('espeak-ng')`;
- 删除 `createRequire` import 与 `ESPEAK_PKG_JSON` 常量;
- 文件头新增 ⚠ 注释:本文件禁止再用 createRequire/require.resolve(见 stub 根因)。

动态 import(`getTTS`)保持不变——已验证 webpack 原样保留,无需改动。

## Alternatives considered

**在 next.config 里把 createRequire 相关模块 externalize。** 否决:webpack 的
createRequire stub 化是 Next 内置行为,配置绕行复杂且脆弱,不如源头不用。

**用动态 import 探测依赖(`await import(KOKORO_PKG)` 成功与否)。**
否决:探测路径(route.ts GET/POST 的同步调用链)是同步的,动态 import 是异步的,
需把整条链改异步;且 fs 探测已足够准确(依赖安装 = 目录存在)。

## Consequences

- 线上修复:合入后重新 `./rebuild.sh`(镜像重建 + 容器重启)即恢复「本地语音」,
  无需动模型卷;
- `kokoroPkgDir()` 从「createRequire 解析包入口推导」改为「fs 向上探测目录」,
  两者结果一致(容器内 /app/node_modules/kokoro-js-zh),且不再依赖 webpack;
- 依赖未安装(=0 镜像)时 `findNodeModulesDir` 返回 null,行为与原来一致
  (kokoroInstalled false → edge 兜底),无回归;
- 后续任何包路径探测(espeak-ng 等)都走 `findNodeModulesDir`,规避同类 stub 坑。

与 [2026-09-04-compose-kokoro-build-arg-fix](./2026-09-04-compose-kokoro-build-arg-fix.md)
交叉链接:同一现象(线上无「本地语音」)的两个叠加根因——compose args 写死
(依赖没装)与 webpack createRequire stub(依赖装了但探测必败);本笔记是后者。
