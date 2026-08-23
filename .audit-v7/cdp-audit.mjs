// V7-PR39 首页 Discovery 审计:板块渲染/热度排序/PV 联动/继续阅读/猜你喜欢
const CDP = 'http://127.0.0.1:9229';
const BASE = 'http://127.0.0.1:3458';
const UNIQ = `d${Date.now() % 100000}`;

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); let loadResolve = null;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method === 'Page.loadEventFired' && loadResolve) { const r = loadResolve; loadResolve = null; r(); } };
function send(method, params = {}) { return new Promise((r2) => { const id = ++seq; pending.set(id, r2); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function goto(path) { await send('Page.navigate', { url: BASE + path }); await new Promise((r) => { loadResolve = r; setTimeout(r, 15000); }); await sleep(1600); }

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const results = []; const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); };

// 1) 匿名首页:今日推荐 hero=热门之书(6PV 由下方制造?先看初始排序)
await goto('/');
{
  const s = await evalJs(`(() => ({
    hero: document.querySelector('h1')?.textContent,
    sections: [...document.querySelectorAll('section h2')].map(h=>h.textContent),
    hotFirst: [...document.querySelectorAll('section')].find(x=>x.querySelector('h2')?.textContent==='热门小说')?.querySelector('h3')?.textContent
  }))()`);
  check('今日推荐 hero 渲染', Boolean(s.hero), s.hero);
  check('板块齐全(热门/最新更新/新书)', ['热门小说','最新更新','新书推荐'].every(t=>s.sections.includes(t)), JSON.stringify(s.sections));
  check('匿名无 猜你喜欢', !s.sections.includes('猜你喜欢'));
}

// 2) PV 联动:刷热门之书第1章 3 次 → 首页热门榜首应为它
for (let i = 0; i < 3; i++) {
  await goto('/books/v-hot/chapter/1');
  await sleep(900);
}
await goto('/');
{
  const hotFirst = await evalJs(`[...document.querySelectorAll('section')].find(x=>x.querySelector('h2')?.textContent==='热门小说')?.querySelector('h3')?.textContent`);
  check('PV 上报后热门榜首=热门之书', hotFirst === '热门之书', String(hotFirst));
}

// 3) 登录 → 继续阅读 + 猜你喜欢
await goto('/login');
{
  const reg = await evalJs(`fetch('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'${UNIQ}',email:'${UNIQ}@x.com',password:'password123'})}).then(r=>r.status)`);
  check('注册成功', reg === 200, String(reg));
}
await goto('/');
{
  const s = await evalJs(`(() => ({ sections: [...document.querySelectorAll('section h2')].map(h=>h.textContent) }))()`);
  check('登录后首页含 猜你喜欢', s.sections.includes('猜你喜欢'), JSON.stringify(s.sections));
}
await goto('/books/v-hot');
{
  // 收藏科幻书 → 猜你喜欢的理由徽章应出现同分类
  await evalJs(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('收藏'))?.click()`);
  await sleep(1000);
}
await goto('/books/v-hot/chapter/1');
await sleep(800);
await evalJs(`window.scrollTo(0, document.documentElement.scrollHeight * 0.9)`);
await sleep(2000);
await goto('/');
{
  const cont = await evalJs(`(() => ({ has: [...document.querySelectorAll('section h2')].some(h=>h.textContent==='继续阅读'), row: document.body.textContent.includes('第1章') }))()`);
  check('阅读后首页出现 继续阅读', cont.has === true);
  const foryou = await evalJs(`(() => { const sec=[...document.querySelectorAll('section')].find(x=>x.querySelector('h2')?.textContent==='猜你喜欢'); return sec ? sec.body_text ?? sec.textContent.slice(0,120) : ''; })()`);
  check('猜你喜欢板块有内容', Boolean(foryou && foryou.length > 10), (foryou||'').slice(0,60));
}

console.log(`\nV7 Discovery 首页审计:${results.filter(r=>r.ok).length}/${results.length} 通过`);
process.exit(results.some(r=>!r.ok) ? 1 : 0);
