/**
 * V4 Story Core 服务层验证:世界观 upsert、人物 CRUD 与重名守卫、
 * 人物关系、故事线状态机、章节大纲 upsert、伏笔埋设/回收幂等、每书隔离。
 *
 * 运行:npm run test:story
 * 数据库使用临时目录(NOVEL_DATA_DIR),不触碰 data/novel.db。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NOVEL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-story-'));

const {
  CoreError,
  createBook,
  getWorld,
  upsertWorld,
  listCharacters,
  upsertCharacter,
  updateCharacter,
  deleteCharacter,
  listRelationships,
  addRelationship,
  deleteRelationship,
  listArcs,
  createArc,
  updateArc,
  deleteArc,
  listOutlines,
  setOutline,
  deleteOutline,
  listForeshadowing,
  plantForeshadowing,
  resolveForeshadowing,
  deleteForeshadowing,
} = await import('@novel/core');

let failed = 0;

function assertOk(cond: boolean, name: string): void {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

async function assertThrows(code: string, fn: () => unknown | Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    assertOk(false, `${name}(未抛错)`);
  } catch (err) {
    assertOk(err instanceof CoreError && err.code === code, name);
  }
}

// 种子:两本书(隔离验证)
const b1 = createBook({ slug: 'story-core-a', title: '星陨之地', authorName: '测A', categoryName: '科幻', tags: [] });
const b2 = createBook({ slug: 'story-core-b', title: '深空回响', authorName: '测B', categoryName: '科幻', tags: [] });

// ---------- 世界观 ----------
{
  const empty = getWorld(b1.id);
  assertOk(empty.setting === '' && empty.rules === '' && empty.createdAt === null, '未创建时返回虚拟空世界观');

  const w = upsertWorld(b1.id, { setting: '灵气复苏的现代都市', rules: '单章三千字;每章一个钩子' });
  assertOk(w.setting.includes('灵气复苏') && w.createdAt !== null, 'upsert 创建世界观');

  const w2 = upsertWorld(b1.id, { setting: '灵气复苏的近未来都市' });
  assertOk(w2.setting.includes('近未来') && w2.rules.includes('钩子'), '二次 upsert 只改 setting 保留 rules');

  await assertThrows('BOOK_NOT_FOUND', () => upsertWorld('book_nope', { setting: 'x' }), '世界观:书不存在 → BOOK_NOT_FOUND');
}

// ---------- 人物 ----------
{
  const c = upsertCharacter(b1.id, { name: '陆沉', role: 'protagonist', persona: '外冷内热', state: '重伤初愈' });
  assertOk(c.role === 'protagonist' && c.state === '重伤初愈', '创建主角');

  const again = upsertCharacter(b1.id, { name: '陆沉', state: '伤愈,实力突破' });
  assertOk(again.id === c.id && again.state === '伤愈,实力突破' && again.persona === '外冷内热', '同名 upsert 更新不重复');

  await assertThrows('INVALID_STATUS', () => upsertCharacter(b1.id, { name: 'X', role: 'boss' as never }), '非法 role → INVALID_STATUS');
  await assertThrows('BOOK_NOT_FOUND', () => listCharacters('book_nope'), '人物列表:书不存在');

  const c2 = upsertCharacter(b1.id, { name: '苏离', role: 'antagonist' });
  const upd = updateCharacter(b1.id, c2.id, { persona: '亦敌亦友' });
  assertOk(upd.persona === '亦敌亦友' && upd.name === '苏离', 'updateCharacter 部分更新');
  await assertThrows('CHARACTER_NAME_TAKEN', () => updateCharacter(b1.id, c2.id, { name: '陆沉' }), '改名撞名 → CHARACTER_NAME_TAKEN');
  await assertThrows('CHARACTER_NOT_FOUND', () => updateCharacter(b1.id, 99999, { persona: 'x' }), '人物不存在 → CHARACTER_NOT_FOUND');

  // b2 同名允许(每书隔离)
  const b2same = upsertCharacter(b2.id, { name: '陆沉' });
  assertOk(listCharacters(b2.id).length === 1 && b2same.bookId === b2.id, '跨书同名互不干扰;b1 列表不受影响');
  assertOk(deleteCharacter(b2.id, b2same.id) && listCharacters(b2.id).length === 0, 'deleteCharacter 生效');
}

// ---------- 人物关系 ----------
{
  const rel = addRelationship(b1.id, { fromName: '陆沉', toName: '苏离', kind: '宿敌', note: '旧案纠缠' });
  assertOk(rel.fromName === '陆沉' && rel.kind === '宿敌' && rel.note === '旧案纠缠', '添加关系并映射 camelCase');
  await assertThrows('RELATIONSHIP_NOT_FOUND', () => addRelationship(b1.id, { fromName: '', toName: '苏离', kind: '盟友' }), '关系缺字段 → RELATIONSHIP_NOT_FOUND');
  assertOk(listRelationships(b1.id).length === 1 && deleteRelationship(b1.id, rel.id), '删除关系');
  assertOk(listRelationships(b1.id).length === 0, '关系列表清空');
}

// ---------- 故事线 ----------
{
  const arc = createArc(b1.id, { title: '第一卷·觉醒', summary: '陆沉获得异能', startChapter: 1 });
  assertOk(arc.status === 'planned' && arc.startChapter === 1, '创建故事线默认 planned');
  const act = updateArc(b1.id, arc.id, { status: 'active', endChapter: 30 });
  assertOk(act.status === 'active' && act.endChapter === 30 && act.summary !== '', '故事线转 active');
  await assertThrows('INVALID_STATUS', () => updateArc(b1.id, arc.id, { status: 'running' as never }), '非法故事线状态 → INVALID_STATUS');
  await assertThrows('ARC_NOT_FOUND', () => updateArc(b1.id, 99999, { title: 'x' }), '故事线不存在 → ARC_NOT_FOUND');
  assertOk(listArcs(b1.id)[0].title === '第一卷·觉醒' && deleteArc(b1.id, arc.id), '删除故事线');
}

// ---------- 章节大纲 ----------
{
  setOutline(b1.id, { number: 3, title: '初入秘境', beats: '- 秘境入口开启\n- 遭遇 first 血战' });
  const o = setOutline(b1.id, { number: 3, title: '初入秘境(修订)', beats: '- 秘境入口开启\n- 血战\n- 拾得信物' });
  assertOk(o.title.includes('修订') && o.beats.includes('信物'), 'setOutline 幂等覆盖');
  assertOk(listOutlines(b1.id).length === 1 && listOutlines(b1.id)[0].number === 3, '同号不重复,按章号排序');
  await assertThrows('OUTLINE_NOT_FOUND', () => setOutline(b1.id, { number: 0 }), '章号非正整数 → OUTLINE_NOT_FOUND');
  assertOk(deleteOutline(b1.id, 3) && listOutlines(b1.id).length === 0, '删除大纲');
}

// ---------- 伏笔 ----------
{
  const f1 = plantForeshadowing(b1.id, { label: '神秘玉佩', detail: '第2章出现,来历不明', plantedChapter: 2 });
  plantForeshadowing(b1.id, { label: '苏离的旧照片', plantedChapter: 4 });
  const open = listForeshadowing(b1.id, { openOnly: true });
  assertOk(open.length === 2 && f1.resolvedChapter === null, '埋设两条未回收伏笔');

  const resolved = resolveForeshadowing(b1.id, f1.id, 12);
  assertOk(resolved.resolvedChapter === 12, '回收伏笔记录回收章号');
  const againResolved = resolveForeshadowing(b1.id, f1.id, 20);
  assertOk(againResolved.resolvedChapter === 12, '重复回收幂等保留首次章号');
  assertOk(listForeshadowing(b1.id, { openOnly: true }).length === 1, 'openOnly 只剩一条');

  await assertThrows('FORESHADOWING_NOT_FOUND', () => resolveForeshadowing(b1.id, 99999, 5), '伏笔不存在 → FORESHADOWING_NOT_FOUND');
  await assertThrows('FORESHADOWING_NOT_FOUND', () => plantForeshadowing(b1.id, { label: '' }), '空标签 → FORESHADOWING_NOT_FOUND');
  assertOk(deleteForeshadowing(b1.id, f1.id) && listForeshadowing(b1.id).length === 1, '删除伏笔');
}

console.log(failed === 0 ? '\nStory Core 服务层全部验证通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
