// 演示模式本地数据层：与云函数保持同一套接口语义
// 数据仅保存在本机 Storage，用于在未配置云环境时体验完整流程
const { composeLetter } = require('./letter-template');
const titleOf = require('./title');
const moments = require('./moments');
const petLife = require('./pet-life');
const moodLog = require('./mood-log');
const tribute = require('./tribute');
const timeCapsule = require('./time-capsule');

const K = {
  pet: 'demo_pet',
  letters: 'demo_letters'
};

// 演示模式没有模型成本，冷却给短一点，方便反复看不同版本
const LETTER_COOLDOWN = 5 * 60 * 1000;
const KEEP_LETTERS = 20;

const UID = 'demo-user';

function get(k, def) {
  try {
    const v = wx.getStorageSync(k);
    return v === '' ? def : v;
  } catch (e) {
    return def;
  }
}
function set(k, v) {
  try { wx.setStorageSync(k, v); } catch (e) { /* ignore */ }
}

// ---------- 用户 ----------
async function ensureUser() {
  return { uid: UID, nickname: '演示用户' };
}

// ---------- 宠物 ----------
async function getPet() {
  return get(K.pet, null);
}

async function createPet(data) {
  const pet = {
    _id: 'demo-pet-' + Date.now(),
    name: data.name,
    personality: data.personality || 'friendly',
    // 性格自定义（#9）：与云端 pets.persona 同结构，null 表示全用预设
    persona: data.persona || null,
    type: data.type || 'other',
    ownerName: titleOf.normalize(data.ownerName),
    sinceDate: data.sinceDate || '',
    storageMode: data.storageMode || 'private',
    photo: data.photo || '',
    // 去白底后的透明版：原图留着，展示时优先用它。kind 决定桌面上的呈现
    // （cutout = 主体带填充，直接浮在桌面上；line = 线条没围住东西，只剩线条，夜里翻成亮色）
    photoCut: data.photoCut || '',
    photoCutKind: data.photoCut ? (data.photoCutKind || 'cutout') : '',
    // 隐私模式照片 22 小时后过期（与云端规则一致，留出清理缓冲）
    photoExpiresAt: (data.storageMode || 'private') === 'private' && data.photo ? Date.now() + 22 * 3600e3 : null,
    createdAt: Date.now()
  };
  set(K.pet, pet);
  return pet;
}

async function updatePet(patch) {
  const pet = get(K.pet, null);
  if (!pet) throw new Error('还没有宠物档案');
  ['name', 'personality', 'persona', 'type', 'ownerName', 'sinceDate', 'storageMode', 'photo', 'photoCut', 'photoCutKind'].forEach((k) => {
    if (patch[k] !== undefined) pet[k] = patch[k];
  });
  // 称呼在存储层就归一化：空串代表「没填」，读取时才补「主人」
  if (patch.ownerName !== undefined) pet.ownerName = titleOf.normalize(patch.ownerName);
  // 换了照片但没带新的透明版，说明这张新图没处理成功或者不需要处理：
  // 旧照片的抠图必须一起扔掉，否则新照片会顶着上一张的轮廓显示
  if (patch.photo !== undefined && patch.photoCut === undefined) {
    pet.photoCut = '';
    pet.photoCutKind = '';
  }
  if (!pet.photoCut) pet.photoCutKind = '';
  if (patch.photo !== undefined) {
    pet.photoExpiresAt = pet.storageMode === 'private' && patch.photo ? Date.now() + 22 * 3600e3 : null;
  } else if (patch.storageMode === 'persistent') {
    pet.photoExpiresAt = null;
  } else if (patch.storageMode === 'private' && pet.photo) {
    pet.photoExpiresAt = Date.now() + 22 * 3600e3;
  }
  set(K.pet, pet);
  return pet;
}

async function deletePet() {
  set(K.pet, null);
  // 删宠物 = 删干净：信、互动统计、它的心情和日记、思念信都不能留下来
  set(K.letters, []);
  moments.reset();
  petLife.reset();
  moodLog.reset();
  tribute.reset();
  timeCapsule.reset();
}

// 立即删除照片（不等 22 小时自动过期）
async function removePhoto() {
  const pet = get(K.pet, null);
  if (!pet) return { removed: false, reason: 'no-pet' };
  pet.photo = '';
  pet.photoCut = '';
  pet.photoCutKind = '';
  pet.photoExpiresAt = null;
  set(K.pet, pet);
  return { removed: true };
}

// 清空全部数据：宠物档案、它写的信、互动统计、心情日记全部清除
async function purgeAll() {
  const summary = {
    pets: get(K.pet, null) ? 1 : 0,
    letters: (get(K.letters, []) || []).length,
    assetRecords: 0,
    files: 0
  };
  set(K.pet, null);
  set(K.letters, []);
  moments.reset();
  petLife.reset();
  moodLog.reset();
  tribute.reset();
  timeCapsule.reset();
  return { purged: true, summary };
}

// 导出我的数据（查阅 / 复制权）。结构与云端 account.export 保持一致
async function exportAll() {
  const pet = get(K.pet, null);
  const letters = get(K.letters, []) || [];

  return {
    exportedAt: Date.now(),
    scope: 'local',
    pet: pet ? {
      name: pet.name,
      personality: pet.personality,
      persona: pet.persona || null,
      type: pet.type,
      ownerName: pet.ownerName,
      sinceDate: pet.sinceDate,
      storageMode: pet.storageMode,
      hasPhoto: !!pet.photo,
      createdAt: pet.createdAt
    } : null,
    counts: {
      letters: letters.length,
      assets: pet && pet.photo ? 1 : 0
    },
    letters: letters.map((l) => ({ content: l.content, createdAt: l.createdAt })),
    assets: pet && pet.photo
      ? [{ purpose: 'pet', status: 'active', createdAt: pet.createdAt, expiresAt: pet.photoExpiresAt || null }]
      : []
  };
}

// ---------- 一封信 ----------
async function getLetter() {
  const list = get(K.letters, []);
  const letter = list[0] || null;
  return { letter, nextAt: letter ? letter.createdAt + LETTER_COOLDOWN : 0 };
}

// 全部信件（时间轴用）：最新的在前
async function listLetters() {
  return get(K.letters, []) || [];
}

async function generateLetter({ ownerTitle: passedTitle, stats } = {}) {
  const pet = get(K.pet, null);
  if (!pet) throw new Error('请先创建宠物');

  const list = get(K.letters, []);
  const prev = list[0];
  if (prev && Date.now() - prev.createdAt < LETTER_COOLDOWN) {
    const min = Math.max(1, Math.ceil((LETTER_COOLDOWN - (Date.now() - prev.createdAt)) / 60000));
    throw new Error('刚写过一封啦，' + min + ' 分钟后再来听听它想说什么吧');
  }

  // 档案里的称呼优先，入参只做兜底：调用方可能是个还没读到 pet 的旧入口
  const ownerTitle = titleOf.resolveName(pet.ownerName || passedTitle);

  // 聊天功能已砍掉，不再有「你说过的话」可引用，信只基于互动统计生成
  const content = composeLetter({ pet, stats: stats || {}, ownerTitle, excerpts: [] });
  const letter = {
    _id: 'demo-letter-' + Date.now(),
    petId: pet._id,
    petName: pet.name,
    ownerTitle: ownerTitle || titleOf.DEFAULT_TITLE,
    content,
    isDemo: true,
    stats: stats || {},
    createdAt: Date.now()
  };
  list.unshift(letter);
  set(K.letters, list.slice(0, KEEP_LETTERS));
  return { letter, nextAt: letter.createdAt + LETTER_COOLDOWN };
}

module.exports = {
  ensureUser, getPet, createPet, updatePet, deletePet,
  removePhoto, purgeAll, exportAll,
  getLetter, listLetters, generateLetter
};
