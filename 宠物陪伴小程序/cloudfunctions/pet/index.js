const cloud = require('wx-server-sdk');
const titleOf = require('./title');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 隐私模式照片有效期 22 小时：清理任务每小时执行一次，
// 保证文件实际保留时间必然小于 24 小时（预留重试缓冲）
const PRIVATE_TTL = 22 * 60 * 60 * 1000;
const PERSONALITIES = ['loyal', 'lively', 'foodie', 'friendly'];
const TYPES = ['cat', 'dog', 'other'];

// 性格自定义（#9）：用户可覆盖/补充的项目。
// 服务端必须自己清洗，不能信前端——prompt 是要塞进模型的，超长或异常字符会直接搞坏请求。
const PERSONA_SCENES = ['touch', 'feed', 'play', 'lift'];
const PERSONA_LIMITS = { speech: 40, catchphrase: 12, quirk: 40, trait: 8, scene: 40 };

function clipText(v, max) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return s ? s.slice(0, max) : '';
}

function sanitizePersona(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};

  const traits = Array.isArray(input.traits)
    ? input.traits
      .map((t) => clipText(t, PERSONA_LIMITS.trait))
      .filter(Boolean)
      .slice(0, 3)
    : [];
  if (traits.length) out.traits = traits;

  const speech = clipText(input.speech, PERSONA_LIMITS.speech);
  const catchphrase = clipText(input.catchphrase, PERSONA_LIMITS.catchphrase);
  const quirk = clipText(input.quirk, PERSONA_LIMITS.quirk);
  if (speech) out.speech = speech;
  if (catchphrase) out.catchphrase = catchphrase;
  if (quirk) out.quirk = quirk;

  const scenes = {};
  PERSONA_SCENES.forEach((k) => {
    const v = clipText((input.scenes || {})[k], PERSONA_LIMITS.scene);
    if (v) scenes[k] = v;
  });
  if (Object.keys(scenes).length) out.scenes = scenes;

  // 全空就存 null，别在文档里留一个空对象占位
  return Object.keys(out).length ? out : null;
}

function ok(data) {
  return { ok: true, data };
}
function fail(e) {
  return { ok: false, error: (e && e.message) || '服务异常，请稍后重试' };
}

async function getPetDoc(openid) {
  const r = await db.collection('pets').where({ _openid: openid }).limit(1).get();
  return r.data[0] || null;
}

async function removeAssetsOfPet(openid, pet) {
  const assets = await db.collection('mediaAssets')
    .where({ _openid: openid, purpose: 'pet' })
    .get();
  const fileList = assets.data.filter((a) => a.fileID).map((a) => a.fileID);
  if (fileList.length) {
    await cloud.deleteFile({ fileList }).catch(() => {});
  }
  for (const a of assets.data) {
    await db.collection('mediaAssets').doc(a._id).remove().catch(() => {});
  }
  void pet;
}

async function getPet(openid) {
  const pet = await getPetDoc(openid);
  return ok(pet);
}

async function createPet(openid, p) {
  const name = (p.name || '').trim();
  if (!name) throw new Error('请给宠物起个名字');
  if (name.length > 12) throw new Error('名字最多 12 个字');
  if (!PERSONALITIES.includes(p.personality)) throw new Error('请选择性格');
  if (p.type && !TYPES.includes(p.type)) p.type = 'other';
  const storageMode = p.storageMode === 'persistent' ? 'persistent' : 'private';

  // 第一版每用户一只宠物：重复创建时先清理旧档案（幂等，避免重复数据）
  const old = await getPetDoc(openid);
  if (old) {
    await removeAssetsOfPet(openid, old);
    await db.collection('pets').doc(old._id).remove();
    // 旧宠物的信也不能留：换一只宠物后不该还读得到上一只写的信
    await db.collection('letters').where({ _openid: openid }).remove().catch(() => {});
  }

  let assetId = '';
  if (p.photoFileID) {
    const asset = await db.collection('mediaAssets').add({
      data: {
        _openid: openid,
        fileID: p.photoFileID,
        purpose: 'pet', // 用途：宠物形象
        storageMode,
        expiresAt: storageMode === 'private' ? Date.now() + PRIVATE_TTL : null,
        status: 'active',
        createdAt: Date.now()
      }
    });
    assetId = asset._id;
  }

  // 去白底后的透明版：和原图同一个 purpose，清理任务按 purpose 一起删，
  // 不会出现「原图删了、透明版还躺在云存储里」的情况
  if (p.photoCutFileID) {
    await db.collection('mediaAssets').add({
      data: {
        _openid: openid,
        fileID: p.photoCutFileID,
        purpose: 'pet',
        storageMode,
        expiresAt: storageMode === 'private' ? Date.now() + PRIVATE_TTL : null,
        status: 'active',
        createdAt: Date.now()
      }
    });
  }

  const personaDoc = sanitizePersona(p.persona);
  const pet = await db.collection('pets').add({
    data: {
      _openid: openid,
      name,
      personality: p.personality,
      persona: personaDoc,
      type: p.type || 'other',
      ownerName: titleOf.normalize(p.ownerName),
      sinceDate: p.sinceDate || '',
      storageMode,
      photo: p.photoFileID || '',
      photoCut: p.photoCutFileID || '',
      assetId,
      createdAt: Date.now()
    }
  });
  return ok({ _id: pet._id });
}

async function updatePet(openid, p) {
  const pet = await getPetDoc(openid);
  if (!pet) throw new Error('还没有宠物档案');

  const patch = {};
  if (p.name !== undefined) {
    const name = p.name.trim();
    if (!name) throw new Error('名字不能为空');
    patch.name = name.slice(0, 12);
  }
  if (p.personality !== undefined) {
    if (!PERSONALITIES.includes(p.personality)) throw new Error('性格不合法');
    patch.personality = p.personality;
  }
  // 传 persona 就整份替换（前端每次提交的是完整编辑结果，不做部分合并，
  // 否则用户清空某个字段时无法表达「清空」意图）
  if (p.persona !== undefined) {
    patch.persona = sanitizePersona(p.persona);
  }
  if (p.type !== undefined && TYPES.includes(p.type)) patch.type = p.type;
  if (p.ownerName !== undefined) patch.ownerName = titleOf.normalize(p.ownerName);
  if (p.sinceDate !== undefined) patch.sinceDate = p.sinceDate;

  // 更换照片：旧素材立即标记过期（由清理任务删除文件），新素材按当前模式建档
  if (p.newPhotoFileID) {
    if (pet.assetId) {
      await db.collection('mediaAssets').doc(pet.assetId).update({
        data: { status: 'replaced', expiresAt: Date.now() }
      }).catch(() => {});
    }
    const storageMode = p.storageMode || pet.storageMode;
    const asset = await db.collection('mediaAssets').add({
      data: {
        _openid: openid,
        fileID: p.newPhotoFileID,
        purpose: 'pet',
        storageMode,
        expiresAt: storageMode === 'private' ? Date.now() + PRIVATE_TTL : null,
        status: 'active',
        createdAt: Date.now()
      }
    });
    patch.photo = p.newPhotoFileID;
    // 换图时新的透明版跟着换；这张新图没处理成功就把旧的一起清掉，
    // 否则新照片会顶着上一张的轮廓显示
    patch.photoCut = p.newPhotoCutFileID || '';
    if (p.newPhotoCutFileID) {
      await db.collection('mediaAssets').add({
        data: {
          _openid: openid,
          fileID: p.newPhotoCutFileID,
          purpose: 'pet',
          storageMode,
          expiresAt: storageMode === 'private' ? Date.now() + PRIVATE_TTL : null,
          status: 'active',
          createdAt: Date.now()
        }
      });
    }
    patch.assetId = asset._id;
    patch.storageMode = storageMode;
  } else if (p.storageMode !== undefined && p.storageMode !== pet.storageMode) {
    // 切换保存模式：同步调整素材生命周期
    const storageMode = p.storageMode === 'persistent' ? 'persistent' : 'private';
    patch.storageMode = storageMode;
    if (pet.assetId) {
      await db.collection('mediaAssets').doc(pet.assetId).update({
        data: {
          storageMode,
          expiresAt: storageMode === 'private' ? Date.now() + PRIVATE_TTL : null
        }
      }).catch(() => {});
    }
  }

  await db.collection('pets').doc(pet._id).update({ data: patch });
  return ok({ updated: true });
}

async function deletePet(openid) {
  const pet = await getPetDoc(openid);
  if (!pet) return ok({ deleted: true });
  await removeAssetsOfPet(openid, pet);
  await db.collection('pets').doc(pet._id).remove();
  // 删除全部数据：信也要一起删干净
  await db.collection('letters').where({ _openid: openid }).remove().catch(() => {});
  return ok({ deleted: true });
}

exports.main = async (event) => {
  const { action, ...payload } = event || {};
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '身份获取失败' };
  try {
    switch (action) {
      case 'get': return await getPet(OPENID);
      case 'create': return await createPet(OPENID, payload);
      case 'update': return await updatePet(OPENID, payload);
      case 'delete': return await deletePet(OPENID);
      default: return { ok: false, error: '未知操作' };
    }
  } catch (e) {
    return fail(e);
  }
};
