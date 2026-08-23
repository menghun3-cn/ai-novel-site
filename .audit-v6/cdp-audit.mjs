// V6-PR34 端到端审计:注册→详情收藏/订阅→章节滚动→书架进度+更新提示→个人中心历史→登出
const CDP = 'http://127.0.0.1:9229';
const BASE = 'http://127.0.0.1:3458';
const UNIQ = `u${Date.now() % 100000}`;

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); let loadResolve = null;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Page.loadEventFired' && loadResolve) { const r = loadResolve; loadResolve = null; r(); } };
function send(method, params = {}) { return new Promise((r2) => { const id = ++seq; pending.set(id, r2); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function goto(path) { await send('Page.navigate', { url: BASE + path }); await new Promise((r) => { loadResolve = r; setTimeout(r, 15000); }); await sleep(1500); }

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const results = []; const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

// 1) 页面上下文里直接注册(拿 Cookie)
await goto('/login');
{
  const reg = await evalJs(`fetch('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'${UNIQ}',email:'${UNIQ}@x.com',password:'password123'})}).then(r=>r.status)`);
  check('注册成功(200)', reg === 200, String(reg));
}

// 2) 详情页 收藏/订阅
await goto('/books/audit-book');
{
  const before = await evalJs(`(() => ({ fav: [...document.querySelectorAll('button')].map(b=>b.textContent).find(t=>t.includes('收藏')), sub: [...document.querySelectorAll('button')].map(b=>b.textContent).find(t=>t.includes('订阅')) }))()`);
  check('详情页有 收藏/订阅 按钮', Boolean(before.fav && before.sub), JSON.stringify(before));
  await evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('收藏'))?.click()`);
  await sleep(900);
  await evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('订阅'))?.click()`);
  await sleep(900);
  const after = await evalJs(`(() => ({ fav: [...document.querySelectorAll('button')].map(b=>b.textContent).find(t=>t.includes('收藏')), sub: [...document.querySelectorAll('button')].map(b=>b.textContent).find(t=>t.includes('订阅')) }))()`);
  check('点击后翻转 已收藏/已订阅', after.fav.includes('已收藏') && after.sub.includes('已订阅'), JSON.stringify(after));
}

// 3) 章节1 滚动 → 进度上报
await goto('/books/audit-book/chapter/1');
{
  await sleep(1200);
  await evalJs(`window.scrollTo(0, document.documentElement.scrollHeight * 0.85)`);
  await sleep(2500);
  // 触发 pagehide 兜底
  await goto('/shelf');
  const shelf = await evalJs(`fetch('/api/me/shelf').then(r=>r.json())`);
  const e = shelf.entries?.[0];
  check('书架含该书', e && e.title === '审计之书', JSON.stringify(shelf.entries?.map((x) => x.title)));
  check(`阅读至第1章·进度>50%`, e.progressChapter === 1 && e.progressPercent > 50, `第${e?.progressChapter}章 ${e?.progressPercent}%`);
  check('有更新 徽章(latest=2)', e.hasUpdate === true && e.latestChapter === 2, `hasUpdate=${e?.hasUpdate}`);
  const badge = await evalJs(`document.body.textContent.includes('有更新')`);
  check('页面渲染 有更新 徽章', badge === true);
  check('显示 阅读至第N章 文案', (await evalJs(`document.body.textContent.includes('阅读至第1章')`)) === true);

  // 继续阅读按钮指向下一章(进度85%<95% → 回第1章;改为校验链接存在)
  const cont = await evalJs(`[...document.querySelectorAll('a')].find(a=>a.textContent==='继续阅读')?.href ?? ''`);
  check('继续阅读按钮存在', cont.includes('/chapter/'), cont);
}

// 4) 追平最新 → 更新提示消失
{
  await goto('/books/audit-book/chapter/2');
  await sleep(1000);
  await evalJs(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await sleep(2500);
  await goto('/shelf');
  await sleep(800);
  const noBadge = await evalJs(`!document.body.textContent.includes('有更新')`);
  check('追平最新后 无更新提示', noBadge === true);
}

// 5) 个人中心 历史
await goto('/me');
{
  const hist = await evalJs(`(() => ({ has: document.body.textContent.includes('最近阅读'), latest: document.body.textContent.includes('第2章 · 100%'), user: document.body.textContent.includes('${UNIQ}') }))()`);
  check('个人中心含账号与最近进度(每书一行)', hist.has && hist.user && hist.latest, JSON.stringify(hist));
}

// 6) 登出
{
  await evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('退出登录'))?.click()`);
  await sleep(1800);
  const s = await evalJs(`(() => [...document.querySelectorAll('header a')].map(a=>a.textContent))()`);
  check('退出后 Header 恢复 登录/注册', s.includes('登录') && s.includes('注册'), JSON.stringify(s));
}

console.log(`\nV6 书架审计:${results.filter((r) => r.ok).length}/${results.length} 通过`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
