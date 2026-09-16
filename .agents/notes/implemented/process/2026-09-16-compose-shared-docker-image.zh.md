# Agent Note: web and scheduler share one Docker image via an explicit Compose tag

Status: implemented

English | [中文](2026-09-16-compose-shared-docker-image.zh.md)

## Problem

本仓库用单个 `Dockerfile` 产出一份运行时负载(基础镜像、`node_modules`、`core/`、`importer/`、Next.js 生产构建与两个入口脚本),但 `docker-compose.yml` 给 `web` 和 `scheduler` 都只写了 `build:` 而没有 `image:` 字段。Compose 会把每个构建出的镜像自动命名为 `<项目名>-<服务名>`,于是每次构建都打出两个标签——`novel-web-publisher-web` 与 `novel-web-publisher-scheduler`——内容逐字节相同。两个服务真正的差异只有启动命令,而它存在于 `command:` / `CMD` 元数据里,是 `docker compose up` 运行时才注入的,从来不在镜像内。

同一份负载存两遍既浪费又脆弱。`docker image ls` 按标签各报 ~875 MB;虽然两次完全相同的构建在磁盘上确实会共享层,但这种共享是偶然的:浮动基础标签 `node:22-slim`、`--no-cache` 重建或 builder 缓存被 prune 都会悄悄打破它,真实占用翻倍到 ~1.75 GB,还要维护两个标签的推送、拉取、升级与审计。

## Decision

在 `docker-compose.yml` 的两个 service 上各自显式声明同一个镜像名:

```yaml
web:
  image: novel-web-publisher:latest
  build:
    context: .

scheduler:
  image: novel-web-publisher:latest
  build: .
```

Compose 只构建一次共享负载(第二个 service 的构建全命中缓存,给同一内容补打标签),两个容器都从唯一的 `novel-web-publisher:latest` 标签启动。运行时角色不变:`web` 沿用 Dockerfile 默认的 `npm run start -w web`,`scheduler` 保留 `command: ["npx", "tsx", "scripts/publish-scheduler.ts"]` 覆盖;任何服务的端口、卷、`mem_limit`、restart 策略与 `stop_grace_period` 都不变。合并镜像不是合并容器——两者仍是各自独立、限流与生命周期互不牵制的进程。

存量部署在首次重建后需一次性清理两个旧自动命名标签:

```sh
docker image rm novel-web-publisher-web novel-web-publisher-scheduler
```

## Alternatives considered

**做一个不含 Next.js 构建的瘦调度器专用镜像(独立 final stage)。** 调度器的运行时需求是 web 负载的严格子集——重头(基础镜像、共享依赖树)会同时出现在两个镜像里,总磁盘占用反而比单个共享镜像更大,还让 `Dockerfile` 多出一块需要维护的构建面。否决。

**把 web 与 scheduler 塞进同一个容器。** 这会耦合两个互不相关的生命周期:调度器是 7×24 的 tick 循环,优雅停机需要 90 秒释放锁;web 崩溃或重建会悄悄停掉连载。各自的 `mem_limit`(1500 m 对 256 m)与 restart 策略也会丢失。本改动刻意保留双容器拓扑。否决。

**依赖 OverlayFS 层共享,保留两个标签。** 层去重只在两次构建产出相同 digest 时成立;浮动基础标签或 `--no-cache` 重建会静默破坏它,且仍要管理两个名字。显式共享标签让"只存一份"成为永久保证,也让拓扑自解释。否决。

## Consequences

- 构建、推送、拉取、升级、审计的对象只有一个镜像标签;无论基础镜像漂移还是无缓存重建,磁盘占用都保证只有一份。
- 运行时拓扑、限额、卷与部署流程(`./rebuild.sh`、`docker compose up -d`)均不变;`npm run pack:deploy` 打的 zip 本就携带 compose 文件,打包流程无需改动。
- 此改动后的首次部署,需在容器重建后一次性清理两个旧自动命名标签。

## Related

[调度器 sidecar 决策](../../bug-fix/2026-08-24-scheduler-missing-docker.md)引入第二个服务时,本就依赖它与 web 共用同一镜像;本文把这种共用从"恰好如此"变成 Compose 中显式声明的约定。
