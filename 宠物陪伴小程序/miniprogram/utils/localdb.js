// 演示模式本地数据层：与云函数保持同一套接口语义
// 数据仅保存在本机 Storage，用于在未配置云环境时体验完整流程
const { timeAgo } = require('./format');
const { composeLetter } = require('./letter-template');
const titleOf = require('./title');
const moments = require('./moments');
const brain = require('./chat-brain');
const petLife = require('./pet-life');

const K = {
  pet: 'demo_pet',
  messages: 'demo_messages',
  posts: 'demo_posts',
  likes: 'demo_likes',        // { [postId]: true }
  comments: 'demo_comments',  // { [postId]: [comment] }
  reports: 'demo_reports',
  likeDelta: 'demo_like_delta', // { [postId]: n } 示例动态的点赞增减量
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

function seedPosts() {
  return [
    { _id: 'demo-p1', ownerName: '奶油的铲屎官', content: '今天奶油第一次学会握手，奖励了小鱼干，开心得原地转圈圈🐾', images: [], likeCount: 3, commentCount: 1, createdAt: Date.now() - 2 * 3600e3, demo: true },
    { _id: 'demo-p2', ownerName: '豆豆的妈妈', content: '带豆豆去公园晒太阳，它躺在草地上打滚，怎么喊都不肯回家哈哈', images: [], likeCount: 5, commentCount: 0, createdAt: Date.now() - 8 * 3600e3, demo: true },
    { _id: 'demo-p3', ownerName: '煤球的爸爸', content: '“煤球，握手！” 它把爪子轻轻搭上来的瞬间，又被治愈了一次。', images: [], likeCount: 2, commentCount: 0, createdAt: Date.now() - 26 * 3600e3, demo: true }
  ];
}

function seedComments() {
  return {
    'demo-p1': [
      { _id: 'demo-c1', ownerName: '路过的小伙伴', content: '好聪明呀！小鱼干没白花～', createdAt: Date.now() - 1 * 3600e3, mine: false }
    ]
  };
}

function allPosts() {
  const mine = get(K.posts, []);
  return mine.concat(seedPosts()).sort((a, b) => b.createdAt - a.createdAt);
}

function allComments() {
  return Object.assign(seedComments(), get(K.comments, {}));
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
  set(K.messages, []);
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
  set(K.messages, []);
  // 删宠物 = 删干净：信、互动统计、它的心情和日记都不能留下来
  set(K.letters, []);
  moments.reset();
  petLife.reset();
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

// 清空全部数据：连社区动态、评论、点赞、举报一起清
// 与 deletePet 的区别：deletePet 只删私密部分，社区内容保留
async function purgeAll() {
  const posts = get(K.posts, []);
  const comments = get(K.comments, {});
  const likes = get(K.likes, {});
  const summary = {
    pets: get(K.pet, null) ? 1 : 0,
    messages: (get(K.messages, []) || []).length,
    letters: (get(K.letters, []) || []).length,
    posts: posts.length,
    comments: Object.keys(comments).reduce((n, k) => n + (comments[k] || []).length, 0),
    likes: Object.keys(likes).length,
    reports: (get(K.reports, []) || []).length,
    assetRecords: 0,
    files: 0
  };
  set(K.pet, null);
  set(K.messages, []);
  set(K.letters, []);
  set(K.posts, []);
  set(K.likes, {});
  set(K.comments, {});
  set(K.reports, []);
  set(K.likeDelta, {});
  moments.reset();
  petLife.reset();
  return { purged: true, summary };
}

// 导出我的数据（查阅 / 复制权）。结构与云端 account.export 保持一致
async function exportAll() {
  const pet = get(K.pet, null);
  const messages = get(K.messages, []) || [];
  const posts = (get(K.posts, []) || []).slice().sort((a, b) => b.createdAt - a.createdAt);
  const commentMap = get(K.comments, {}) || {};
  const comments = [];
  Object.keys(commentMap).forEach((postId) => {
    (commentMap[postId] || []).forEach((c) => {
      comments.push({ postId, content: c.content, createdAt: c.createdAt });
    });
  });
  comments.sort((a, b) => b.createdAt - a.createdAt);
  const letters = get(K.letters, []) || [];
  const likes = get(K.likes, {}) || {};

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
      messages: messages.length,
      posts: posts.length,
      comments: comments.length,
      likes: Object.keys(likes).length,
      letters: letters.length,
      assets: pet && pet.photo ? 1 : 0
    },
    messages: messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
    posts: posts.map((p) => ({
      content: p.content, images: (p.images || []).length,
      likeCount: p.likeCount || 0, commentCount: p.commentCount || 0, createdAt: p.createdAt
    })),
    comments,
    letters: letters.map((l) => ({ content: l.content, createdAt: l.createdAt })),
    assets: pet && pet.photo
      ? [{ purpose: 'pet', status: 'active', createdAt: pet.createdAt, expiresAt: pet.photoExpiresAt || null }]
      : []
  };
}

// ---------- 对话 ----------
async function getChatHistory() {
  return get(K.messages, []);
}

// 演示模式的回复引擎换成 chat-brain：它和云函数里那份是同一份代码（scripts/sync-shared.js 同步），
// 所以「没配云开发」和「配了云开发但没配模型」两种情况下，对话表现是一致的。
// 心情取 petLife 的实时状态，让它刚睡醒时说话就带点迷糊。
async function sendChat(text) {
  const pet = get(K.pet, null);
  if (!pet) throw new Error('请先创建宠物');
  const messages = get(K.messages, []);
  const now = Date.now();
  messages.push({ _id: 'u' + now, role: 'user', content: text, createdAt: now });
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));

  let live = { mood: 'happy', lastActivityId: '' };
  try { live = petLife.getState(); } catch (e) { /* 读不到就用默认心情，不影响回复 */ }

  const out = brain.reply(text, {
    pet,
    history: messages.slice(-24),
    mood: live.mood,
    activityLabel: petLife.activityLabelOf(live)
  });
  const reply = { content: out.content, isDemo: true, emotion: out.emotion };

  messages.push({ _id: 'p' + Date.now(), role: 'pet', content: reply.content, isDemo: true, createdAt: Date.now() });
  set(K.messages, messages);
  return reply;
}

// ---------- 一封信 ----------
async function getLetter() {
  const list = get(K.letters, []);
  const letter = list[0] || null;
  return { letter, nextAt: letter ? letter.createdAt + LETTER_COOLDOWN : 0 };
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

  const messages = get(K.messages, []) || [];
  const users = messages.filter((m) => m.role === 'user' && m.content);
  const excerpts = users
    .filter((m) => m.content.length >= 4)
    .slice(-3)
    .map((m) => m.content.slice(0, 30));

  const content = composeLetter({ pet, stats: stats || {}, ownerTitle, excerpts });
  const letter = {
    _id: 'demo-letter-' + Date.now(),
    petId: pet._id,
    petName: pet.name,
    ownerTitle: ownerTitle || titleOf.DEFAULT_TITLE,
    content,
    isDemo: true,
    stats: stats || {},
    chatCount: users.length,
    createdAt: Date.now()
  };
  list.unshift(letter);
  set(K.letters, list.slice(0, KEEP_LETTERS));
  return { letter, nextAt: letter.createdAt + LETTER_COOLDOWN };
}

// ---------- 社区 ----------
function attachExtras(post, likes, comments) {
  const list = comments[post._id] || [];
  const delta = get(K.likeDelta, {});
  return Object.assign({}, post, {
    liked: !!likes[post._id],
    mine: post.ownerId === UID,
    timeText: timeAgo(post.createdAt),
    likeCount: Math.max(0, post.likeCount + (delta[post._id] || 0)),
    commentCount: list.length ? list.length : post.commentCount
  });
}

async function listPosts({ cursor, limit = 10 } = {}) {
  const c = cursor || Date.now() + 1;
  const likes = get(K.likes, {});
  const comments = allComments();
  const list = allPosts()
    .filter((p) => p.createdAt < c)
    .slice(0, limit)
    .map((p) => attachExtras(p, likes, comments));
  const nextCursor = list.length === limit ? list[list.length - 1].createdAt : null;
  return { list, nextCursor };
}

async function listMyPosts() {
  const likes = get(K.likes, {});
  const comments = allComments();
  return get(K.posts, [])
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => attachExtras(p, likes, comments));
}

function myDisplayName() {
  const pet = get(K.pet, null);
  if (pet && pet.ownerName) return pet.ownerName;
  if (pet) return pet.name + '的铲屎官';
  return '小伙伴';
}

async function publishPost({ content, images }) {
  if (!content && (!images || !images.length)) throw new Error('写点什么或添加一张图片吧');
  const posts = get(K.posts, []);
  const post = {
    _id: 'demo-post-' + Date.now(),
    ownerId: UID,
    ownerName: myDisplayName(),
    content: content || '',
    images: images || [],
    likeCount: 0,
    commentCount: 0,
    createdAt: Date.now(),
    mine: true
  };
  posts.unshift(post);
  set(K.posts, posts);
  return post;
}

async function deletePost(postId) {
  const posts = get(K.posts, []);
  const idx = posts.findIndex((p) => p._id === postId);
  if (idx < 0) throw new Error('动态不存在');
  if (posts[idx].ownerId !== UID) throw new Error('只能删除自己的动态');
  posts.splice(idx, 1);
  set(K.posts, posts);
  const comments = get(K.comments, {});
  delete comments[postId];
  set(K.comments, comments);
  const likes = get(K.likes, {});
  delete likes[postId];
  set(K.likes, likes);
}

async function toggleLike(postId, liked) {
  const likes = get(K.likes, {});
  if (liked) {
    if (likes[postId]) throw new Error('已经点过赞啦');
    likes[postId] = true;
  } else {
    delete likes[postId];
  }
  set(K.likes, likes);
  // 同步我的动态计数与示例动态计数增量
  const delta = get(K.likeDelta, {});
  delta[postId] = (delta[postId] || 0) + (liked ? 1 : -1);
  set(K.likeDelta, delta);
  const incr = (arr) => arr.map((p) => (p._id === postId ? Object.assign({}, p, { likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)) }) : p));
  set(K.posts, incr(get(K.posts, [])));
  return { liked };
}

async function listComments(postId) {
  const list = (allComments()[postId] || []).map((c) => Object.assign({}, c, { timeText: timeAgo(c.createdAt) }));
  return list;
}

async function addComment(postId, content) {
  const text = (content || '').trim();
  if (!text) throw new Error('评论内容不能为空');
  if (text.length > 200) throw new Error('评论最多 200 字');
  const comments = get(K.comments, {});
  const list = comments[postId] || [];
  const c = { _id: 'demo-c-' + Date.now(), ownerId: UID, ownerName: myDisplayName(), content: text, createdAt: Date.now(), mine: true };
  list.push(c);
  comments[postId] = list;
  set(K.comments, comments);
  const posts = get(K.posts, []).map((p) => (p._id === postId ? Object.assign({}, p, { commentCount: p.commentCount + 1 }) : p));
  set(K.posts, posts);
  return c;
}

async function deleteComment(postId, commentId) {
  const comments = get(K.comments, {});
  const list = comments[postId] || [];
  const idx = list.findIndex((c) => c._id === commentId);
  if (idx < 0) throw new Error('评论不存在');
  if (list[idx].ownerId !== UID) throw new Error('只能删除自己的评论');
  list.splice(idx, 1);
  comments[postId] = list;
  set(K.comments, comments);
  const posts = get(K.posts, []).map((p) => (p._id === postId ? Object.assign({}, p, { commentCount: Math.max(0, p.commentCount - 1) }) : p));
  set(K.posts, posts);
}

async function reportPost(postId, reason) {
  const reports = get(K.reports, []);
  reports.push({ postId, reason, status: 'pending', createdAt: Date.now() });
  set(K.reports, reports);
}

module.exports = {
  ensureUser, getPet, createPet, updatePet, deletePet,
  removePhoto, purgeAll, exportAll,
  getChatHistory, sendChat,
  getLetter, generateLetter,
  listPosts, listMyPosts, publishPost, deletePost, toggleLike,
  listComments, addComment, deleteComment, reportPost
};
