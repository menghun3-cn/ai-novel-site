import { z } from 'zod';
import { deleteCharacter, listCharacters, upsertCharacter, updateCharacter } from '@novel/core';
import { json, readJson, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const upsertSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor']).optional(),
  persona: z.string().max(2000).optional(),
  appearance: z.string().max(2000).optional(),
  background: z.string().max(4000).optional(),
  state: z.string().max(2000).optional(),
  /** 提供时走定点更新(可改名);缺省按名 upsert */
  characterId: z.number().int().positive().optional(),
});

export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({ characters: listCharacters(id) });
});

/** 新建/按名 upsert;带 characterId 时定点更新(支持改名,撞名 → 409) */
export const POST = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson(req, upsertSchema);
  if (body.characterId !== undefined) {
    const { characterId: cid, ...patch } = body;
    return json({ character: updateCharacter(id, cid, patch) });
  }
  return json({ character: upsertCharacter(id, body) });
});

export const DELETE = withAdmin<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const cid = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isInteger(cid) || cid <= 0) return json({ error: 'VALIDATION_FAILED', message: 'id required' }, 400);
  return json({ deleted: deleteCharacter(id, cid) });
});
