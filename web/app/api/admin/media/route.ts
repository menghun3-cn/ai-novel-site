import type { NextRequest } from 'next/server';
import { AdminRouteContext, fail, json, withAdmin } from '@/lib/admin-api';
import { listMedia, saveMedia } from '@/lib/admin-media';

export const dynamic = 'force-dynamic';

export const GET = withAdmin<AdminRouteContext>(async () => json({ media: listMedia() }));

/** multipart/form-data 上传:字段 file(必填),可选用 name 覆盖文件名 */
export const POST = withAdmin<AdminRouteContext>(async (req: NextRequest) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'INVALID_FORM', 'expected multipart/form-data');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return fail(400, 'MISSING_FILE', 'form field "file" is required');
  const override = form.get('name');
  if (override !== null && typeof override !== 'string') {
    return fail(400, 'INVALID_MEDIA_NAME', '"name" must be a string');
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const item = saveMedia(override || file.name, bytes);
  return json({ media: item }, 201);
});
