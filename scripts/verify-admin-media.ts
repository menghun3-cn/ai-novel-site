/**
 * 媒体管理验证:上传(multipart)、白名单、大小上限、重名 409、
 * 公开服务(内容类型/缓存/CSP/404/路径穿越拒绝)、删除。
 *
 * 运行:npm run test:media
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-admin-media-'));
process.env.ADMIN_TOKEN = 'test-token-123';

const { NextRequest } = await import('next/server');

type Handler = (req: NextRequest, ctx?: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;

const mediaRoute = (await import('../web/app/api/admin/media/route.ts')) as unknown as Record<string, Handler>;
const mediaItemRoute = (await import('../web/app/api/admin/media/[name]/route.ts')) as unknown as Record<string, Handler>;
const publicRoute = (await import('../web/app/media/[...path]/route.ts')) as unknown as Record<string, Handler>;

let failed = 0;

function assertOk(cond: boolean, name: string): void {
  if (cond) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-token-123' };
}

function uploadReq(name: string | null, bytes: Uint8Array, type = 'image/png'): NextRequest {
  const form = new FormData();
  const filename = name ?? 'cover.png';
  form.append('file', new File([bytes], filename, { type }));
  return new NextRequest('http://localhost:3000/api/admin/media', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  }) as NextRequest;
}

async function status(p: Response | Promise<Response>): Promise<number> {
  return (await p).status;
}

// ---------- 上传 ----------

const up = await mediaRoute.POST(uploadReq(null, new Uint8Array([137, 80, 78, 71, 1, 2, 3])));
assertOk(up.status === 201 && ((await up.json()) as { media: { url: string } }).media.url === '/media/cover.png', 'PNG 上传 201 且返回 /media URL');

{
  const bad = await mediaRoute.POST(uploadReq('evil.exe', new Uint8Array([1])));
  assertOk(bad.status === 400 && ((await bad.json()) as { error: string }).error === 'UNSUPPORTED_MEDIA_TYPE', '非白名单扩展名映射 400');
}
{
  const trav = await mediaRoute.POST(uploadReq('../../evil.png', new Uint8Array([1])));
  assertOk(trav.status === 400 && ((await trav.json()) as { error: string }).error === 'INVALID_MEDIA_NAME', '路径穿越名拒绝 400');
}
{
  const dup = await mediaRoute.POST(uploadReq('cover.png', new Uint8Array([9])));
  assertOk(dup.status === 409 && ((await dup.json()) as { error: string }).error === 'MEDIA_NAME_TAKEN', '重名上传 409');
}
{
  const big = new Uint8Array(5 * 1024 * 1024 + 1);
  const tooBig = await mediaRoute.POST(uploadReq('big.png', big));
  assertOk(tooBig.status === 413 && ((await tooBig.json()) as { error: string }).error === 'MEDIA_TOO_LARGE', '超过 5MB 413');
}
{
  const noFile = await mediaRoute.POST(
    new NextRequest('http://localhost:3000/api/admin/media', {
      method: 'POST',
      headers: authHeaders(),
      body: new FormData(),
    }) as NextRequest
  );
  assertOk(noFile.status === 400 && ((await noFile.json()) as { error: string }).error === 'MISSING_FILE', '缺少 file 字段 400');
}

// ---------- 列表与公开服务 ----------

{
  const list = await mediaRoute.GET(
    new NextRequest('http://localhost:3000/api/admin/media', { headers: authHeaders() }) as NextRequest
  );
  const items = ((await list.json()) as { media: { name: string }[] }).media;
  assertOk(items.length === 1 && items[0]!.name === 'cover.png', '列表包含已上传媒体');
}

{
  const pub = await publicRoute.GET(new Request('http://localhost:3000/media/cover.png'), {
    params: Promise.resolve({ path: ['cover.png'] }),
  });
  const body = new Uint8Array(await pub.arrayBuffer());
  assertOk(pub.status === 200 && body[0] === 137 && pub.headers.get('content-type') === 'image/png', '公开服务返回字节与内容类型');
  assertOk((pub.headers.get('cache-control') ?? '').includes('immutable'), '公开服务带不可变缓存头');
  assertOk((pub.headers.get('content-security-policy') ?? '').includes('sandbox'), 'SVG/媒体响应带 sandbox CSP');
}

{
  const missing = await publicRoute.GET(new Request('http://localhost:3000/media/nope.png'), {
    params: Promise.resolve({ path: ['nope.png'] }),
  });
  assertOk(missing.status === 404, '不存在的媒体 404');
  const traversal = await publicRoute.GET(new Request('http://localhost:3000/media/../db'), {
    params: Promise.resolve({ path: ['..', 'x.png'] }),
  });
  assertOk(traversal.status === 404, '多段/穿越路径 404');
}

// ---------- 删除 ----------

function req_media_delete(name: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/media/${name}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }) as NextRequest;
}

{
  const del = await mediaItemRoute.DELETE(req_media_delete('cover.png'), {
    params: Promise.resolve({ name: 'cover.png' }),
  });
  assertOk(del.status === 200 && ((await del.json()) as { deleted: boolean }).deleted, '删除媒体 200');
  const again = await mediaItemRoute.DELETE(req_media_delete('cover.png'), {
    params: Promise.resolve({ name: 'cover.png' }),
  });
  assertOk(again.status === 404 && ((await again.json()) as { error: string }).error === 'MEDIA_NOT_FOUND', '重复删除 404');
}

if (failed > 0) {
  console.error(`\n${failed} 项媒体验证失败`);
  process.exit(1);
}
console.log('\n媒体管理全部验证通过');
