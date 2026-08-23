import { getWorld, listArcs, listCharacters, listForeshadowing, listOutlines, listRelationships } from '@novel/core';
import { json, withAdmin } from '@/lib/admin-api';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** 一次拉齐某书全部 Story Core 事实(工作台单页读模型) */
export const GET = withAdmin<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json({
    world: getWorld(id),
    characters: listCharacters(id),
    relationships: listRelationships(id),
    arcs: listArcs(id),
    outlines: listOutlines(id),
    foreshadowing: listForeshadowing(id),
  });
});
