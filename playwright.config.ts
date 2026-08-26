/**
 * Playwright E2E 冒烟配置(仓库首个 e2e 装置)。
 *
 * 运行:npm run test:e2e
 *   - 数据目录:e2e/.tmpdata(独立于开发库;首次运行自动播种,见 e2e/seed.ts)
 *   - Web 服务器:next dev -p 3100(复用已开实例时跳过启动)
 *
 * 说明:冒烟走 dev 服务器(按需编译,免整包 build);如需验证生产产物,
 * 把 webServer.command 换成 `npm run build -w web && npm run start -w web -- -p 3100`。
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

// 数据目录先于一切 import 固定(@novel/core 在模块加载时解析 NOVEL_DATA_DIR)
const dataDir = path.resolve(here, 'e2e/.tmpdata');
process.env.NOVEL_DATA_DIR = dataDir;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    // 优先系统 Edge(Chromium 内核,免下载);CI 或无 Edge 环境删掉此行后 `npx playwright install chromium`
    channel: 'msedge',
    trace: 'retain-on-failure',
    locale: 'zh-CN',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  webServer: {
    // 生产模式:单进程稳定(dev 模式下曾出现 readiness 后被静默杀掉的假死);
    // 首次或代码变更后需先 `npm run build -w web`
    command: `npm run start -w web -- -p ${PORT}`,
    cwd: here,
    url: BASE_URL,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
    env: {
      ...process.env,
      NOVEL_DATA_DIR: dataDir,
      PORT: String(PORT),
    },
  },
});

// 配置加载即播种(webServer 子进程继承本进程 env;core 单例在测试进程内同样生效)
// 默认每次全量重置数据目录,保证登录/种子状态确定;E2E_KEEP_DATA=1 可复用。
// 先清掉占用端口的残留 dev server(此前超时被杀的 npm 外壳会遗孤 node 进程),
// 否则其句柄会让 rmSync EBUSY、旧任务/密码态跨运行泄漏。
function killPortListeners(port: number): void {
  try {
    cp.execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"`,
      { stdio: 'ignore', timeout: 15_000 }
    );
  } catch {
    /* 端口本就空闲 */
  }
}
// 数据目录重置 + 端口清理只做一次:config 会被主进程与每个 worker 各自加载一遍,
// 否则 worker 启动时会把刚就绪的 webServer 当残留进程杀掉(readiness 后假死的根因)。
if (!process.env.E2E_KEEP_DATA && !process.env.E2E_CLEANED) {
  process.env.E2E_CLEANED = '1';
  killPortListeners(PORT);
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[e2e] 数据目录重置失败(可能有进程占用),复用现有数据:${(err as Error).message}`);
  }
}
fs.mkdirSync(dataDir, { recursive: true });
void (async (): Promise<void> => {
  const { seedE2eData } = await import('./e2e/seed.js');
  const seeded = await seedE2eData();
  console.log(`[e2e] seed ok: longBook=${seeded.longBookSlug} shortStory=${seeded.shortStoryId}`);
})();
