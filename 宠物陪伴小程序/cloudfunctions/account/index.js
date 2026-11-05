const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 数据管理云函数：立即删除照片 / 清空全部数据 / 导出我的数据
// 这三个能力对应个人信息保护法里的「删除权」与「查阅、复制权」，
// 与 pet 的 delete（删档案、保留社区内容）区别开：
//   删档案 = 只删私密部分；purge = 连主动公开的社区内容一起删干净
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

// 计数器只减不增，且不允许出现负数（inc 会减成负值，所以先读后写）
async function decField(collection, docId, field, n) {
  if (!n) return;
  const r = await db.collection(collection).doc(docId).get().catch(() => null);
  if (!r || !r.data) return;
  const next = Math.max(0, (r.data[field] || 0) - n);
  await db.collection(collection).doc(docId).update({ data: { [field]: next } }).catch(() => {});
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
    data: { photo: '', assetId: '' }
  });
  return ok({ removed: true, assets });
}

// ---------- 清空全部数据 ----------
async function purge(openid) {
  const summary = {
    pets: 0, messages: 0, letters: 0, posts: 0,
    comments: 0, likes: 0, reports: 0, assetRecords: 0, files: 0
  };

  // 1. 我发布的动态：图片文件 + 该动态下的评论/点赞 + 动态本身
  const posts = await fetchAll(() => db.collection('posts').where({ _openid: openid }));
  for (const p of posts) {
    const fileList = (p.images || []).filter(Boolean);
    if (fileList.length) {
      await cloud.deleteFile({ fileList }).catch(() => {});
      summary.files += fileList.length;
    }
    await db.collection('comments').where({ postId: p._id }).remove().catch(() => {});
    await db.collection('likes').where({ postId: p._id }).remove().catch(() => {});
    await db.collection('posts').doc(p._id).remove().catch(() => {});
    summary.posts++;
  }

  // 2. 我在别人动态下的评论（按动态聚合扣减计数）
  const myComments = await fetchAll(() => db.collection('comments').where({ _openid: openid }));
  const cMap = {};
  myComments.forEach((c) => { cMap[c.postId] = (cMap[c.postId] || 0) + 1; });
  await db.collection('comments').where({ _openid: openid }).remove().catch(() => {});
  for (const pid of Object.keys(cMap)) {
    await decField('posts', pid, 'commentCount', cMap[pid]);
  }
  summary.comments = myComments.length;

  // 3. 我点过的赞（计数同样要回收）
  const myLikes = await fetchAll(() => db.collection('likes').where({ _openid: openid }));
  const lMap = {};
  myLikes.forEach((l) => { lMap[l.postId] = (lMap[l.postId] || 0) + 1; });
  await db.collection('likes').where({ _openid: openid }).remove().catch(() => {});
  for (const pid of Object.keys(lMap)) {
    await decField('posts', pid, 'likeCount', lMap[pid]);
  }
  summary.likes = myLikes.length;

  // 4. 我提过的举报记录
  const reports = await fetchAll(() => db.collection('reports').where({ _openid: openid }));
  await db.collection('reports').where({ _openid: openid }).remove().catch(() => {});
  summary.reports = reports.length;

  // 5. 宠物素材（文件 + 记录）
  const assets = await purgePetAssets(openid);
  summary.assetRecords = assets.records;
  summary.files += assets.files;

  // 6. 宠物档案 / 聊天 / 信
  const pets = await fetchAll(() => db.collection('pets').where({ _openid: openid }));
  for (const p of pets) {
    await db.collection('pets').doc(p._id).remove().catch(() => {});
  }
  summary.pets = pets.length;

  const msg = await fetchAll(() => db.collection('messages').where({ _openid: openid }));
  await db.collection('messages').where({ _openid: openid }).remove().catch(() => {});
  summary.messages = msg.length;

  const letters = await fetchAll(() => db.collection('letters').where({ _openid: openid }));
  await db.collection('letters').where({ _openid: openid }).remove().catch(() => {});
  summary.letters = letters.length;

  return ok({ purged: true, summary });
}

// ---------- 导出我的数据 ----------
async function exportAll(openid) {
  const [pet, msgs, posts, comments, likes, letters, assets] = await Promise.all([
    getPetDoc(openid),
    fetchAll(() => db.collection('messages').where({ _openid: openid }).orderBy('createdAt', 'asc')),
    fetchAll(() => db.collection('posts').where({ _openid: openid }).orderBy('createdAt', 'desc')),
    fetchAll(() => db.collection('comments').where({ _openid: openid }).orderBy('createdAt', 'desc')),
    fetchAll(() => db.collection('likes').where({ _openid: openid })),
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
      messages: msgs.length,
      posts: posts.length,
      comments: comments.length,
      likes: likes.length,
      letters: letters.length,
      assets: assets.length
    },
    messages: msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
    posts: posts.map((p) => ({
      content: p.content, images: (p.images || []).length,
      likeCount: p.likeCount || 0, commentCount: p.commentCount || 0, createdAt: p.createdAt
    })),
    comments: comments.map((c) => ({ postId: c.postId, content: c.content, createdAt: c.createdAt })),
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
