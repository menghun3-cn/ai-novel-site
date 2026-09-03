# Novel Builder 部署与使用说明

> 适用于：Linux 服务器自托管，BookOrbit 原生运行、图书目录为宿主机路径 `/home/app/bookorbit/books` 的场景。
>
> 开发向文档（本地快速开始、API 列表等）见 [`README.md`](README.md)。

---

## 1. 项目简介

Novel Builder 把 `novels/` 目录下的小说（Markdown / TXT 章节）自动构建为标准 EPUB 3，并投递到 BookOrbit 的图书目录，由 BookOrbit 自动导入阅读。

```text
novels/（MD/TXT 小说源）
   │
   ▼
Novel Builder（解析 → 排序 → 元数据 → EPUB 3 → Manifest）
   │
   ▼
BookOrbit 图书目录（宿主机 /home/app/bookorbit/books）
   │
   ▼
BookOrbit（书库管理 + 阅读）
```

关键设计：

- **`novels/` 永远是事实来源**，与阅读端完全解耦；
- 一本小说 = 一个目录 = 一本 EPUB；
- 增量检测（Manifest + SHA-256）：内容未变不重复构建、不重复投递；
- 文件监听：新增章节自动重建并投递；
- 输出文件名固定为 `<书名>.epub`，同书名覆盖，不会在 BookOrbit 里无限堆重复书籍。

---

## 2. 目录结构

```text
novel-builder/
├── novels/                     # 小说源（永久数据源）
│   ├── 星海余烬/
│   │   ├── book.yaml           # 书籍元数据
│   │   ├── cover.svg           # 封面（可选）
│   │   ├── chapters/           # 章节（001.md / 001.txt …）
│   │   ├── assets/             # 插图等资源（预留）
│   │   └── .manifest.json      # 构建状态（自动生成）
│   └── 长风渡/
│       ├── book.yaml
│       └── 全书.txt            # 整本 TXT，自动拆章
├── output/                     # EPUB 构建产物（本地调试用）
├── bookdock/                   # 默认投递目录（可覆盖为 BookOrbit 图书目录）
├── logs/                       # 日志
├── config/config.yaml          # 配置
├── src/                        # 源码
└── scripts/verify.ts           # 端到端验证脚本
```

---

## 3. 环境要求

- Node.js ≥ 20（推荐 22）、npm；
- （可选）Docker / docker compose；
- BookOrbit 已部署，且其图书目录为宿主机路径（本说明以 `/home/app/bookorbit/books` 为例）。

---

## 4. 安装

```bash
cd /path/to/novel-builder
npm install
npm run build          # 编译 TypeScript → dist/
```

---

## 5. 本地快速开始（开发/测试）

```bash
npm run once           # 一次性构建全部小说并投递（默认投递到 ./bookdock）
npm test               # 端到端验证（构建 + EPUB 结构校验）
npm run dev            # 常驻：HTTP 服务 + 文件监听，自动构建投递
```

---

## 6. 服务器部署（与 BookOrbit 对接）

BookOrbit 原生运行，图书目录是**宿主机路径** `/home/app/bookorbit/books`。
目标：让 Novel Builder 把生成的 `.epub` **直接写进该目录**。

### 6.1 前置检查

```bash
# 确认 BookOrbit 图书目录存在且可写（Novel Builder 运行用户需要有写权限）
ls -ld /home/app/bookorbit/books
```

### 6.2 方案一：Novel Builder 原生运行（推荐）

用环境变量 `NOVEL_BOOKDOCK_DIR` 把投递目录指到 BookOrbit 图书目录，无需改公共配置文件：

```bash
# 一次性构建全部并投递
NOVEL_BOOKDOCK_DIR=/home/app/bookorbit/books npm run once

# 常驻运行（构建 + 文件监听 + HTTP API）
NOVEL_BOOKDOCK_DIR=/home/app/bookorbit/books npm start
```

推荐用 systemd 托管常驻服务（开机自启、崩溃自动拉起）：

```ini
# /etc/systemd/system/novel-builder.service
[Unit]
Description=Novel Builder (MD/TXT -> EPUB -> BookOrbit)
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/novel-builder
Environment=NOVEL_BOOKDOCK_DIR=/home/app/bookorbit/books
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=youruser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now novel-builder
sudo systemctl status novel-builder
```

### 6.3 方案二：Novel Builder 跑在 Docker

把宿主机 `/home/app/bookorbit/books` 挂载为容器的 bookdock 输出目录
（`docker-compose.yml` 已内置这种写法）。

**操作步骤：**

1. 确认服务器已安装 Docker 及 compose 插件：`docker --version`、`docker compose version`。
2. 把项目上传/克隆到服务器（例如 `/srv/novel-builder`），并 `cd` 进入该目录。
3. 编辑 `docker-compose.yml`：
   - 把 `/home/app/bookorbit/books` 改成服务器上 BookOrbit 的真实图书目录；
   - 若本机没有 BookOrbit，可改成 `./bookdock`（宿主机目录，后续由 BookOrbit 再挂载，见 6.4）。
4. 把小说源放进 `./novels/`（每本小说一个子目录，含 `book.yaml` 和 `chapters/` 或整本 TXT）。
5. 构建镜像并启动（首次会自动构建，包含 `npm install` 和 TypeScript 编译）：

   ```bash
   docker compose up -d --build
   ```

6. 按 6.5 自检。

对应编排要点：

```yaml
services:
  novel-builder:
    build: .
    container_name: novel-builder
    restart: unless-stopped
    # 容器内必须监听 0.0.0.0，端口映射才能从宿主机访问 API
    # （config.yaml 默认 127.0.0.1 只适合本机运行）。
    command: ["node", "dist/index.js", "--host", "0.0.0.0"]
    ports:
      - "8320:8320"
    environment:
      NOVEL_LIBRARY_ROOT: /data          # 容器内数据根
      NOVEL_BOOKDOCK_DIR: /data/bookdock # bookdock = 容器挂载点
    volumes:
      - ./novels:/data/novels:rw
      - ./output:/data/output:rw
      - /home/app/bookorbit/books:/data/bookdock:rw   # ★ 直接写入 BookOrbit 图书目录
      - ./logs:/data/logs:rw
      - ./config:/app/config:ro
```

常用运维命令：

```bash
docker compose ps                      # 查看运行状态
docker compose logs -f novel-builder   # 跟踪日志
docker compose restart                 # 重启容器
docker compose down                    # 停止
docker compose up -d --build           # 代码有更新时重建镜像并重启
```

### 6.4 方案三：BookOrbit 也跑在 Docker（共享卷）

两容器共享同一个宿主机文件夹：Novel Builder 写 `./bookdock`，BookOrbit 把
`./bookdock` 挂到它**容器内**的图书目录。此时 `/home/app/bookorbit/books`
是容器内路径，需与 BookOrbit 镜像实际路径一致（见 README「方案 A」）。

### 6.5 部署后自检

```bash
# 1) EPUB 已写入 BookOrbit 图书目录？
ls -la /home/app/bookorbit/books/*.epub

# 2) 服务日志正常？
journalctl -u novel-builder -f        # systemd 方式
docker compose logs -f novel-builder  # Docker 方式

# 3) 健康检查
curl http://127.0.0.1:8320/api/health

# 4) 小说列表与构建状态
curl http://127.0.0.1:8320/api/books
```

确认 EPUB 出现在图书目录后，在 BookOrbit 侧触发/等待扫描（取决于 BookOrbit 的自动导入设置）。

---

## 7. 配置说明（`config/config.yaml`）

```yaml
library:
  novelsDir: novels            # 小说源目录（相对 NOVEL_LIBRARY_ROOT）
  outputDir: output            # EPUB 构建产物
  bookdockDir: bookdock        # 投递目录（可用 NOVEL_BOOKDOCK_DIR 覆盖）
  logsDir: logs                # 日志目录

server:
  host: 127.0.0.1
  port: 8320                   # HTTP API 端口

watch:
  enabled: true                # 文件监听
  debounceMs: 500              # 防抖（合并高频文件事件）
  stabilityCheckMs: 2000       # 首次稳定等待（防止读到未写完的文件）
  stabilityIntervalMs: 400     # 两次快照间隔

sync:
  enabled: true                # 是否自动投递
  retries: 3                   # 投递失败重试次数
  retryDelayMs: 1000           # 重试间隔
```

环境变量（优先级高于 config.yaml）：

| 变量 | 作用 |
|---|---|
| `NOVEL_LIBRARY_ROOT` | 容器内数据根，`library.*` 相对路径基于它解析 |
| `NOVEL_BOOKDOCK_DIR` | 单独覆盖投递目录（直接指向 BookOrbit 图书目录） |

---

## 8. CLI 与 REST API

### CLI

```text
npm run once -- --book 星海余烬   # 只构建指定小说
npm run once -- --force           # 强制重建（忽略内容哈希）
npm start -- --no-watch           # 服务但不监听文件
npm start -- --port 9000          # 覆盖端口
```

### REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/books` | 小说列表与构建状态 |
| GET | `/api/books/:id` | 单本状态 |
| POST | `/api/build` | 构建指定小说（内容未变则跳过） |
| POST | `/api/rebuild` | 强制重建 |
| POST | `/api/sync` | 构建并投递 |

```bash
curl -X POST http://127.0.0.1:8320/api/sync -H 'Content-Type: application/json' \
     -d '{"book":"星海余烬"}'
```

### 管理后台(`/admin`)账号

- SQLite 初始化时自动播种初始管理员:**`admin` / `Admin@123456`**;
- **首次登录强制改密**:必须修改为复杂密码才能进入后台(规则:≥10 位,同时包含大写字母、小写字母、数字、特殊字符,且不得包含账号名);
- 改密完成前,除 `/api/admin/auth/*` 外的业务管理 API 一律返回 `403 PASSWORD_CHANGE_REQUIRED`;
- 管理会话有效期 24 小时;后台顶栏钥匙图标可随时再次修改密码(改密会吊销该账号其他会话);
- 机器令牌环境变量 `ADMIN_TOKEN` 仍受支持(`Authorization: Bearer …` / `x-admin-token`),供调度器与集成脚本向后兼容;
- 验证:`npm run test:admin-auth`。

---

## 9. 自动构建机制

- 监听 `novels/` 下所有 `.md/.txt/.yaml/封面图片`；
- 事件 **防抖**（debounceMs）合并高频触发；
- **稳定性检查**：文件大小/修改时间连续两次快照一致才构建，避免读到未写完的文件；
- **去重队列**：同一小说同时只跑一个构建任务；
- **增量**：Manifest 记录内容哈希，内容未变不重建、不重复投递；
- **失败重试**：投递失败按 `sync.retries` 重试；
- **重启追赶**：服务启动时全量扫描一次，补齐漏掉的变更。

---

## 10. 常见问题（FAQ）

**Q1：BookOrbit 没有自动导入？**
EPUB 已写入图书目录但 BookOrbit 未入库：确认该目录是否设置了只读挂载、运行用户是否有写权限；然后在 BookOrbit 侧触发/等待扫描（自动导入与扫描策略取决于 BookOrbit 设置）。

**Q2：会不会在 BookOrbit 里生成重复书籍？**
不会。输出文件名固定为 `<书名>.epub`，同一本书始终覆盖同名文件；BookOrbit 按文件名/书籍标识识别更新。

**Q3：中文乱码？**
EPUB 全部使用 UTF-8，章节 XHTML 声明 `charset="utf-8"`；请确保源 `.md/.txt` 文件本身是 UTF-8 编码。

**Q3.1：`npm run pack:deploy` 打包脚本报错或打出的 zip 在 Linux 解压出乱码文件名？**
打包脚本要求 **PowerShell 7（`pwsh`）**。Windows 自带的 `powershell` 是 5.1（.NET Framework），存在两个坑：按本地 GBK 误读无 BOM 的 UTF-8 脚本；`ZipFile` 写出的 zip 条目名用反斜杠（Linux 解压会生成文件名带 `\` 的坏文件）。npm script 已固定走 `pwsh`；手动执行时请用 `pwsh -File scripts/pack-deploy.ps1`，脚本内置版本守卫（低于 7 直接拒绝并提示）。PowerShell 安装地址：https://aka.ms/powershell

**Q3.2：Docker 构建时 `npm install` 报 ETIMEDOUT？**
镜像构建需要在容器内安装 npm 依赖（部署包刻意不带 node_modules——`better-sqlite3` 是原生模块，Windows 机器上的二进制在 Linux 容器里不可用）。Dockerfile 已默认全镜像源，服务器零编译：
- npm 包 → `npmmirror`（`ARG NPM_REGISTRY`）
- better-sqlite3 预编译 linux-x64 二进制 → npmmirror 二进制镜像（`npm_config_better_sqlite3_binary_host_mirror`），不触发 node-gyp 源码编译

海外环境或走代理时覆盖：
```bash
docker compose build \
  --build-arg NPM_REGISTRY=https://registry.npmjs.org \
  --build-arg SQLITE_BINARY_MIRROR=   # 留空则回退 GitHub Releases
```
依赖清单（package.json / package-lock.json）不变的前提下，重复 `./rebuild.sh` 的 deps 层直接命中 Docker 缓存，秒级完成。

> 注：`rebuild.sh` 与 `data/` 不打进部署 zip。前者是 zip 不保存 Unix 执行位，避免重置服务器上已赋权的脚本（等效命令 `docker compose build && docker compose up -d`）；后者保证**升级解压永不覆盖服务器数据库**。新服务器首次部署后导入小说：
> ```bash
> docker compose exec web npm run import:novel -- /app/novels/星海余烬
> docker compose exec web npm run import:novel -- /app/novels/长风渡
> ```

**Q3.3：如何启用听书「本地语音」（Kokoro TTS）？**
`rebuild.sh` **默认已启用**本地语音引擎并自动下载中文模型，直接执行即可：
```bash
./rebuild.sh
# 等价拆分执行:
#   docker compose build --build-arg ENABLE_LOCAL_TTS=1   # 镜像内置 kokoro-js-zh + 语音
#   ./rebuild.sh --model                                  # 模型权重下载到 ./models/kokoro
```
说明：
- **默认行为**：`--tts`（镜像内置 kokoro-js-zh 中文 fork + onnxruntime-node + espeak-ng.wasm + 8 个中文语音）与 `--model`（下载 `onnx/model_quantized.onnx` 到 `./models/kokoro`）都默认开启；**模型已存在时自动跳过下载、零网络请求**。
- **onnxruntime-node 离线安装**：1.29+ 的 Linux x64 CPU 二进制已捆绑在 npm 包内，构建时用 `ONNXRUNTIME_NODE_INSTALL=skip` 跳过其 install 脚本对未捆绑 CUDA/GPU 二进制的下载（该下载走 NuGet 302 重定向且无镜像可用，国内构建必失败；CPU 推理用不到）。无需任何二进制镜像配置。
- **逃生门**：不需要本地引擎时 `./rebuild.sh --no-tts`（镜像不含本地引擎、体积不变，听书回退 Edge 在线合成）；模型已手动放置时 `./rebuild.sh --no-model`。
- `--model` 下载的是 `onnx-community/Kokoro-82M-v1.0-ONNX` 的 `onnx/model_quantized.onnx`（q8 量化）等文件（compose 已挂载为 `/app/models/kokoro`）。**必须下载 `onnx/model_quantized.onnx`**——引擎 q8 固定找 `_quantized` 后缀 + `onnx/` 子目录，其它文件（model.onnx / model_q8.onnx）不会被加载。模型卡: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- 模型远端默认走 **hf-mirror**（国内可直连）；海外服务器设 `KOKORO_HF_ENDPOINT=https://huggingface.co` 切官方源。
- 不挂载模型时引擎会尝试在线下载到 `/app/data/.kokoro-cache`（data 卷持久化，重启不丢）。
- 构建启动后会自动在容器内跑合成验证：
```bash
docker compose exec web npm run test:tts-local
```
听书页「朗读引擎」下拉会出现「🎧 本地语音」选项（服务端探测到模型才显示）。可选 8 个中文语音：小小/小北/小妮/小伊（女）、云健/云希/云夏/云扬（男）。

**Q4：修改章节后没反应？**
确认 `watch.enabled: true` 且服务在运行；新章节写入后约 3 秒内（防抖 + 稳定性检查）会自动构建。

**Q5：端口 8320 被占用？**
`--port` 参数或改 `config.yaml` 的 `server.port`。

**Q6：想手动强制重新生成？**
`NOVEL_BOOKDOCK_DIR=/home/app/bookorbit/books npm run once -- --force` 或调用 `POST /api/rebuild`。

---

## 11. 测试与验证

```bash
npm test
# 输出示例：
# ✓ 星海余烬 -> 6 章 | 9.4 KB | synced=true
# ✓ 长风渡   -> 3 章 | 5.9 KB | synced=true
# 全部 2 本验证通过
```

验证脚本会：构建全部小说 → 校验 EPUB（mimetype 首项未压缩、结构完整）→ 输出摘要。
