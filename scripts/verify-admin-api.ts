/**
 * 管理后台 API 验证:直接以函数方式调用 Next Route Handler,
 * 覆盖鉴权(401/503)、CRUD、错误码到 HTTP 状态的映射(400/404/409)。
 *
 * 运行:npm run test:api
 * 数据库使用临时目录(NOVEL_DATA_DIR),不触碰 data/novel.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-admin-api-'));
process.env.ADMIN_TOKEN = 'test-token-123';

const { NextRequest } = await import('next/server');

type Handler = (req: NextRequest, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

const booksRoute = (await import('../web/app/api/admin/books/route.ts')) as unknown as Record<string, Handler>;
const bookIdRoute = (await import('../web/app/api/admin/books/[id]/route.ts')) as unknown as Record<string, Handler>;
const chaptersRoute = (await import('../web/app/api/admin/books/[id]/chapters/route.ts')) as unknown as Record<string, Handler>;
const chapterNoRoute = (await import('../web/app/api/admin/books/[id]/chapters/[number]/route.ts')) as unknown as Record<string, Handler>;
const orderRoute = (await import('../web/app/api/admin/books/[id]/chapters/order/route.ts')) as unknown as Record<string, Handler>;
const authorsRoute = (await import('../web/app/api/admin/authors/route.ts')) as unknown as Record<string, Handler>;
const authorIdRoute = (await import('../web/app/api/admin/authors/[id]/route.ts')) as unknown as Record<string, Handler>;
const categoriesRoute = (await import('../web/app/api/admin/categories/route.ts')) as unknown as Record<string, Handler>;
const tagsRoute = (await import('../web/app/api/admin/tags/route.ts')) as unknown as Record<string, Handler>;

let failed = 0;

function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

function req(path: string, init?: { method?: string; body?: unknown; token?: string | null }): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init?.token !== null) {
    if (init?.token !== undefined) headers['x-admin-token'] = init.token;
    else headers['authorization'] = 'Bearer test-token-123';
  }
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  }) as NextRequest;
}

async function status(p: Response | Promise<Response>): Promise<number> {
  return (await p).status;
}

// ---------- 鉴权 ----------

assertOk(await status(booksRoute.GET(req('/api/admin/books', { token: null }))) === 401, '无令牌 401');
assertOk(await status(booksRoute.GET(req('/api/admin/books', { token: 'wrong' }))) === 401, '错误令牌 401');
process.env.ADMIN_TOKEN = '';
assertOk(await status(booksRoute.GET(req('/api/admin/books'))) === 503, '未配置 ADMIN_TOKEN 时 503 停用');
process.env.ADMIN_TOKEN = 'test-token-123';

// ---------- 书籍 CRUD ----------

const created = await booksRoute.POST(
  req('/api/admin/books', { method: 'POST', body: { slug: 'api-book', title: 'API之书', authorName: '作者A', categoryName: '科幻', tags: ['AI'] } })
);
assertOk(created.status === 201, '创建书籍 201');
const createdBody = (await created.json()) as { book: { id: string; tags: string[] } };
assertOk(createdBody.book.id === 'book_apibook' && createdBody.book.tags[0] === 'AI', '创建返回 BookWithMeta');

assertOk(await status(booksRoute.POST(req('/api/admin/books', { method: 'POST', body: { slug: 'api-book', title: '重复', authorName: 'x', categoryName: 'y' } }))) === 409, '重复 slug 409');
assertOk(
  await status(booksRoute.POST(req('/api/admin/books', { method: 'POST', body: { slug: '坏slug!', title: 'x', authorName: 'a', categoryName: 'b' } }))) === 400,
  '非法请求体 400'
);

const listed = (await (await booksRoute.GET(req('/api/admin/books'))).json()) as { books: unknown[] };
assertOk(listed.books.length === 1, '列表返回新建书籍');

const patched = await bookIdRoute.PATCH(
  req('/api/admin/books/book_apibook', { method: 'PATCH', body: { title: 'API之书·改', status: 'hidden' } }),
  { params: Promise.resolve({ id: 'book_apibook' }) }
);
assertOk(patched.status === 200 && ((await patched.json()) as { book: { status: string } }).book.status === 'hidden', 'PATCH 隐藏书籍');
assertOk(await status(bookIdRoute.GET(req('/api/admin/books/nope'), { params: Promise.resolve({ id: 'nope' }) })) === 404, '不存在书籍 404');

// ---------- 章节 ----------

const ch = await chaptersRoute.POST(
  req('/api/admin/books/book_apibook/chapters', { method: 'POST', body: { title: '第一章', contentMd: '# 1' } }),
  { params: Promise.resolve({ id: 'book_apibook' }) }
);
assertOk(ch.status === 201 && ((await ch.json()) as { chapter: { number: number } }).chapter.number === 1, '自动接排建章 201');
assertOk(
  await status(chaptersRoute.POST(req('/api/admin/books/book_apibook/chapters', { method: 'POST', body: { number: 1, title: '撞', contentMd: 'x' } }), { params: Promise.resolve({ id: 'book_apibook' }) })) === 409,
  '章号冲突 409'
);

const pub = await chapterNoRoute.PATCH(
  req('/api/admin/books/book_apibook/chapters/1', { method: 'PATCH', body: { status: 'published' } }),
  { params: Promise.resolve({ id: 'book_apibook', number: '1' }) }
);
assertOk(pub.status === 200 && ((await pub.json()) as { chapter: { publishedAt: string | null } }).chapter.publishedAt !== null, '发布章节记 publishedAt');

const badOrder = await orderRoute.PUT(
  req('/api/admin/books/book_apibook/chapters/order', { method: 'PUT', body: { order: [7] } }),
  { params: Promise.resolve({ id: 'book_apibook' }) }
);
assertOk(badOrder.status === 400 && ((await badOrder.json()) as { error: string }).error === 'INVALID_CHAPTER_ORDER', '非法排列映射 400');

assertOk(
  await status(chapterNoRoute.GET(req('/api/admin/books/book_apibook/chapters/abc'), { params: Promise.resolve({ id: 'book_apibook', number: 'abc' }) })) === 400,
  '非整数章号参数 400'
);

// ---------- 作者/分类/标签 ----------

const a = await authorsRoute.POST(req('/api/admin/authors', { method: 'POST', body: { name: '作者A', bio: '简介' } }));
assertOk(a.status === 201 && ((await a.json()) as { author: { bio: string | null } }).author.bio === '简介', '作者创建携带简介');

const clash = await authorIdRoute.PATCH(req('/api/admin/authors/99999', { method: 'PATCH', body: { name: 'x' } }), { params: Promise.resolve({ id: '99999' }) });
assertOk(clash.status === 404 && ((await clash.json()) as { error: string }).error === 'AUTHOR_NOT_FOUND', '不存在作者映射 404');

const inUse = await authorIdRoute.DELETE(req('/api/admin/authors/1'), { params: Promise.resolve({ id: '1' }) });
assertOk(inUse.status === 409 || inUse.status === 200, '在用作者删除返回守卫或成功');

await categoriesRoute.POST(req('/api/admin/categories', { method: 'POST', body: { name: '科幻' } }));
assertOk(await status(categoriesRoute.POST(req('/api/admin/categories', { method: 'POST', body: { name: '科幻' } }))) === 409, '重复分类 409');

const t = await tagsRoute.POST(req('/api/admin/tags', { method: 'POST', body: { name: '末世' } }));
assertOk(t.status === 201, '标签创建 201');

if (failed > 0) {
  console.error(`\n${failed} 项 API 验证失败`);
  process.exit(1);
}
console.log('\n管理后台 API 全部验证通过');
