import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getAuthor, listAuthors, updateAuthor, upsertAuthor } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  bio: z.string().max(3000).nullish(),
  avatarPath: z.string().max(1000).nullish(),
});

export const GET = withAdmin(async () => json({ authors: listAuthors() }));

/** 幂等创建:按名字拿到作者行,再以 update 语义写入简介/头像 */
export const POST = withAdmin(async (req: NextRequest) => {
  const input = await readJson(req, createSchema);
  const id = upsertAuthor(input.name);
  const author = getAuthor(id)!;
  return json(
    {
      author:
        input.bio !== undefined || input.avatarPath !== undefined
          ? updateAuthor(id, { bio: input.bio ?? null, avatarPath: input.avatarPath ?? null })
          : author,
    },
    201
  );
});
