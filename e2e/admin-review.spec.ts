/**
 * 管理后台 + 读者站 E2E 冒烟(仓库首套浏览器级验证)。
 * 覆盖:登录/首登改密 → 评审中心章节 Tab(单章入队)→ 批量入队去重守卫
 *   → 差异对比弹窗 → 质量数据趋势 → 任务列表 → 读者站短篇页 TTS 组件。
 *
 * 前置:e2e/.tmpdata 由 playwright.config.ts 播种(书/章/两条评审记录/一篇已上线短篇)。
 * 运行:npm run test:e2e
 */
import { expect, test, type Page } from '@playwright/test';

const INITIAL_PWD = 'Admin@123456';
const NEW_PWD = 'E2eSmoke!2026';
const BOOK_LABEL = 'E2E 长篇测试书';
const TOKEN_KEY = 'novel:admin-token';

/**
 * 确保已登录:每个 test 都是全新 context(localStorage 不互通)。
 * 直接调登录 API(兼容初始/既改两种密码态),把 token 注入 localStorage 后再进入目标页。
 */
async function ensureLogin(page: Page): Promise<void> {
  for (const pwd of [NEW_PWD, INITIAL_PWD]) {
    const res = await page.request.post('/api/admin/auth/login', {
      data: { username: 'admin', password: pwd },
    });
    if (!res.ok()) continue;
    const body = (await res.json()) as { token: string; mustChangePassword: boolean };
    await page.addInitScript(([key, token]) => window.localStorage.setItem(key, token), [TOKEN_KEY, body.token]);
    return;
  }
  throw new Error('admin 登录失败(初始/既改密码均无效)');
}

async function openReviewTab(page: Page, tabName: string): Promise<void> {
  await ensureLogin(page);
  await page.goto('/admin/review-center');
  await page.getByRole('tab', { name: tabName }).click();
}

/** 章节评审 Tab:切到目标 Tab 并选中种子书目(等待 options 异步加载) */
async function selectBook(page: Page): Promise<void> {
  await openReviewTab(page, '章节评审');
  const select = page.locator('select').first();
  await expect(select).toBeVisible();
  const option = select.locator('option', { hasText: BOOK_LABEL });
  await option.waitFor({ state: 'attached', timeout: 30_000 }); // dev 首次编译较慢
  const value = await option.getAttribute('value');
  await select.selectOption(value!);
  await expect(page.getByText('第 1 章')).toBeVisible({ timeout: 30_000 });
}

test.describe.serial('管理后台冒烟', () => {
  test('登录与首登强制改密', async ({ page }) => {
    await page.goto('/admin/login');
    await page.fill('#admin-username', 'admin');
    // 数据目录被复用时密码可能已改过:先试初始密码,失败再试既改密码
    let loggedIn = false;
    for (const pwd of [INITIAL_PWD, NEW_PWD]) {
      await page.fill('#admin-password', pwd);
      await page.getByRole('button', { name: '进入后台' }).click();
      try {
        await page.waitForURL(/change-password|\/admin(\?.*)?$/, { timeout: 15_000 });
        loggedIn = true;
        break;
      } catch {
        await page.goto('/admin/login');
        await page.fill('#admin-username', 'admin');
      }
    }
    expect(loggedIn, '使用初始或既改密码均可登录').toBeTruthy();

    // 首登(初始密码)会跳强制改密页;复用数据目录时已在 /admin 则跳过改密段
    if (page.url().includes('change-password')) {
      await page.fill('#cur-password', INITIAL_PWD);
      await page.fill('#new-password', NEW_PWD);
      await page.fill('#confirm-password', NEW_PWD);
      await page.getByRole('button', { name: '确认修改并进入后台' }).click();
    }
    await expect(page).toHaveURL(/\/admin(\?.*)?$/, { timeout: 30_000 });
  });

  test('章节评审 Tab:选书出章列表,单章入队成功', async ({ page }) => {
    await selectBook(page);
    await expect(page.locator('span.text-lg.font-bold', { hasText: '78' })).toBeVisible(); // 种子最新评审分(加粗分数)

    await page.getByRole('button', { name: '入队评审', exact: true }).click();
    // 正常应提示入队成功;若跨运行残留了同章 PENDING 任务,则命中去重守卫的告警 —— 两者都算通过
    await expect(page.getByText(/章节评审任务已入队|已有待处理评审任务/)).toBeVisible();
  });

  test('批量入队:去重守卫生效(0 成功 1 跳过)', async ({ page }) => {
    await selectBook(page);
    await page.getByText('全选已发布').click();
    await page.getByRole('button', { name: '批量入队评审' }).click();
    // 第 1 章已有 PENDING 任务(上一条用例入队),应被跳过而不是重复入队
    await expect(page.getByText(/批量入队完成:\s*0 成功.*1 跳过/)).toBeVisible();
  });

  test('差异对比弹窗:分数轨迹与维度升降', async ({ page }) => {
    await selectBook(page);
    await page.getByRole('button', { name: '对比' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(page.getByText('分数轨迹')).toBeVisible();
    await expect(page.getByText('+16')).toBeVisible(); // 62 → 78
    await expect(page.getByText('维度对比(首评 → 最新)')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('质量数据 Tab:7 日趋势与维度均分渲染', async ({ page }) => {
    await openReviewTab(page, '质量数据');
    await expect(page.getByText('近 7 日评审量')).toBeVisible();
    await expect(page.getByText('章节维度均分', { exact: false })).toBeVisible();
    await expect(page.getByText('弧评累计', { exact: false })).toBeVisible();
  });

  test('评审任务列表出现 AI_REVIEW_CHAPTER 记录', async ({ page }) => {
    await ensureLogin(page);
    await page.goto('/admin/review-center');
    await page.reload(); // 入队动作发生在前序用例,刷新拿最新任务列表
    await page.getByRole('tab', { name: '评审任务' }).click();
    await expect(page.getByText('AI_REVIEW_CHAPTER').first()).toBeVisible({ timeout: 30_000 });
  });
});

test.describe.serial('读者站冒烟', () => {
  test('短篇阅读页:正文段落与 TTS 控件', async ({ page }) => {
    // 经公开 API 解析种子短篇 id(避免测试硬编码)
    const res = await page.request.get('/api/short-stories');
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { items: Array<{ storyId: string; title: string }> };
    const target = body.items.find((s) => s.title === 'E2E 短篇测试');
    expect(target, '种子短篇已上线').toBeTruthy();

    await page.goto(`/short/${target!.storyId}`);
    const article = page.locator('#short-story-content');
    await expect(article).toBeVisible();
    expect(await article.locator('p').count()).toBeGreaterThanOrEqual(3);

    // 空闲态:播放 + 停止(禁用)+ 语音下拉(combobox);暂停仅在播放中渲染
    await expect(page.getByRole('button', { name: '播放' })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '选择语音' })).toBeVisible();
  });
});
