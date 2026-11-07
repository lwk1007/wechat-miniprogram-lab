const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 数据管理云函数：立即删除照片 / 清空全部数据 / 导出我的数据
// 这三个能力对应个人信息保护法里的「删除权」与「查阅、复制权」
const PAGE = 100;
const MAX_ROUNDS = 10;

function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: (e && e.message) || '服务异常，请稍后重试' }; }

async function getPetDoc(openid) {
  const r = await db.collection('pets').where({ _openid: openid }).limit(1).get();
  return r.data[0] || null;
}

// 分页拉完某个查询的全部结果，避免单次 limit(100) 漏数据。
// 传入工厂函数而不是查询对象：部分 SDK 版本的 skip 会修改查询自身，
// 复用同一个对象翻页会一直取回第一页
async function fetchAll(makeQuery) {
  const out = [];
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const r = await makeQuery().skip(i * PAGE).limit(PAGE).get().catch(() => ({ data: [] }));
    out.push(...r.data);
    if (r.data.length < PAGE) break;
  }
  return out;
}

// 删除用户名下全部宠物素材（含换下来的旧照片），文件与记录一起清
async function purgePetAssets(openid) {
  let removed = 0;
  let files = 0;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const r = await db.collection('mediaAssets')
      .where({ _openid: openid, purpose: 'pet' })
      .limit(PAGE)
      .get()
      .catch(() => ({ data: [] }));
    if (!r.data.length) break;
    const fileList = r.data.map((a) => a.fileID).filter(Boolean);
    if (fileList.length) {
      await cloud.deleteFile({ fileList }).catch(() => {});
      files += fileList.length;
    }
    for (const a of r.data) {
      await db.collection('mediaAssets').doc(a._id).remove().catch(() => {});
    }
    removed += r.data.length;
    if (r.data.length < PAGE) break;
  }
  return { records: removed, files };
}

// ---------- 立即删除照片 ----------
async function removePhoto(openid) {
  const pet = await getPetDoc(openid);
  if (!pet) return ok({ removed: false, reason: 'no-pet' });
  const assets = await purgePetAssets(openid);
  await db.collection('pets').doc(pet._id).update({
    data: { photo: '', photoCut: '', assetId: '' }
  });
  return ok({ removed: true, assets });
}

// ---------- 清空全部数据 ----------
async function purge(openid) {
  const summary = {
    pets: 0, letters: 0, assetRecords: 0, files: 0
  };

  // 1. 宠物素材（文件 + 记录）
  const assets = await purgePetAssets(openid);
  summary.assetRecords = assets.records;
  summary.files += assets.files;

  // 2. 宠物档案 / 信
  const pets = await fetchAll(() => db.collection('pets').where({ _openid: openid }));
  for (const p of pets) {
    await db.collection('pets').doc(p._id).remove().catch(() => {});
  }
  summary.pets = pets.length;

  const letters = await fetchAll(() => db.collection('letters').where({ _openid: openid }));
  await db.collection('letters').where({ _openid: openid }).remove().catch(() => {});
  summary.letters = letters.length;

  return ok({ purged: true, summary });
}

// ---------- 导出我的数据 ----------
async function exportAll(openid) {
  const [pet, letters, assets] = await Promise.all([
    getPetDoc(openid),
    fetchAll(() => db.collection('letters').where({ _openid: openid }).orderBy('createdAt', 'desc')),
    fetchAll(() => db.collection('mediaAssets').where({ _openid: openid, purpose: 'pet' }))
  ]);

  return ok({
    exportedAt: Date.now(),
    scope: 'cloud',
    pet: pet ? {
      name: pet.name,
      personality: pet.personality,
      type: pet.type,
      ownerName: pet.ownerName,
      sinceDate: pet.sinceDate,
      storageMode: pet.storageMode,
      hasPhoto: !!pet.photo,
      createdAt: pet.createdAt
    } : null,
    counts: {
      letters: letters.length,
      assets: assets.length
    },
    letters: letters.map((l) => ({ content: l.content, createdAt: l.createdAt })),
    assets: assets.map((a) => ({
      purpose: a.purpose, status: a.status,
      createdAt: a.createdAt, expiresAt: a.expiresAt || null
    }))
  });
}

exports.main = async (event) => {
  const { action } = event || {};
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '身份获取失败' };
  try {
    switch (action) {
      case 'removePhoto': return await removePhoto(OPENID);
      case 'purge': return await purge(OPENID);
      case 'export': return await exportAll(OPENID);
      default: return { ok: false, error: '未知操作' };
    }
  } catch (e) {
    return fail(e);
  }
};
