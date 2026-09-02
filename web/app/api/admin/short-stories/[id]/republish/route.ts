import type { NextRequest } from 'next/server';
import { republishShortStory } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';
import { revalidateShortStory } from '@/lib/revalidate';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * 重新发布:把「当前线上 Book+Chapter」原地更新为最新应发版本(优先 is_final,否则最新)。
 * 与 /publish 的区别:不新建 Book(读者链接 /short/[id] 不变),读者下次访问即见新内容;
 * 发布记录追加一行,保留追溯。线上已是最新应发版本时返回 409。
 */
export const POST = withAdmin<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  await req.json().catch(() => ({})); // 允许空 body
  const result = republishShortStory(id);
  revalidateShortStory(id);
  return json({
    publicationId: result.publicationId,
    bookId: result.bookId,
    bookSlug: result.bookSlug,
    versionId: result.versionId,
  });
});
