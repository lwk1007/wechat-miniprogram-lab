// 宠物自主生命引擎
//
// 它不只是被动等待指令：有独立的作息、心情和自己的生活轨迹。
//   · 心情状态机：开心/顽皮/慵懒/犯困/好奇/害羞/委屈/小脾气
//   · 自主活动：12 种，按场景过滤、按性格加权、按作息偏置
//   · 足迹日记：第一人称记录它自己做过的事
//   · 离线补记：你不在的时间里它也在生活，回来时告诉你
//
// 设计上刻意分成两层：
//   rollActivity()  纯函数，只吃 state 吐 nextState，不碰 wx API，可直接单测
//   pickActivity()  薄包装，负责读写 storage 后调用上面那个
// 原实现把「算」和「存」揉在一起，一次调用要读 3 次 storage（同步阻塞），
// 且完全没法在没有 wx 环境的地方验证。分层之后两个问题一起没了。
//
// 数据只在本机：心情和日记是「这段时间」的连续感，不是账号资产。
// 换设备重新开始，比强行同步一份半新不旧的日记更像话。

const { randomFrom, timeAgo } = require('./format');
const timeline = require('./timeline');
// 心情 → 一句自然语言，定义在 chat-brain.js（零外部依赖），这里只引用。
const chatBrain = require('./chat-brain');
const { moodTextOf } = chatBrain;

const STATE_KEY = 'pet_life_state';
const DIARY_KEY = 'pet_diary';
const KEEP_DIARY = 60;
const DIARY_WRITE_RATE = 0.35; // 不是每件事都记，像真的日记本
const SAME_ACTIVITY_GAP = 30 * 60000; // 同一活动 30 分钟内不重复记

// ---------- 心情体系 ----------
const MOODS = {
  happy:   { label: '开心',   face: '😊' },
  playful: { label: '顽皮',   face: '😸' },
  calm:    { label: '慵懒',   face: '😌' },
  sleepy:  { label: '犯困',   face: '😴' },
  curious: { label: '好奇',   face: '🧐' },
  shy:     { label: '害羞',   face: '😳' },
  sulk:    { label: '委屈',   face: '🥺' },
  grumpy:  { label: '小脾气', face: '😾' }
};

// 心情 → 一句自然语言（定义在 chat-brain.js，这里只引用）

// ---------- 自主活动库 ----------
// scenes: null = 任何场景；数组 = 只在这些场景出现
// effect: 陪伴页特效 zzz / sparkle / snack / butterfly / note
const ACTIVITIES = [
  { id: 'stroll', label: '到处溜达嗅嗅', emoji: '🐾', face: '🧐', weight: 3, effect: '', energy: -2, mood: 'curious', scenes: null,
    diaries: ['我在小世界里走了好远好远，每一步都要闻一闻。', '溜达的时候发现了一个新角落，先记下来。'] },
  { id: 'daze', label: '对着空气发呆', emoji: '💭', face: '😌', weight: 3, effect: 'note', energy: 1, mood: 'calm', scenes: null,
    diaries: ['我发了一会儿呆，什么都没想，又好像什么都想了。', '发呆的时候，风从耳边经过，很舒服。'] },
  { id: 'nap', label: '卷成一团打盹', emoji: '💤', face: '😴', weight: 3, effect: 'zzz', energy: 8, mood: 'sleepy', scenes: null,
    diaries: ['我睡了个小觉，梦里全是暖洋洋的光。', '打盹的时候耳朵还在听你的动静哦。'] },
  { id: 'groom', label: '认真打理毛发', emoji: '✨', face: '😊', weight: 2, effect: 'sparkle', energy: -1, mood: 'calm', scenes: null,
    diaries: ['我把毛舔得顺顺的，要一直做一只体面的毛孩子。', '打理完毛发，感觉自己闪闪发光✨'] },
  { id: 'sightsee', label: '安静地看风景', emoji: '🌄', face: '🧐', weight: 2, effect: '', energy: 0, mood: 'calm', scenes: ['grass', 'seaside', 'night', 'window'],
    diaries: ['我看了很久的远处，风景好像也在看我。', '风把云吹成棉花糖的形状，我盯着它们挪来挪去。'] },
  { id: 'snack', label: '偷偷啃小零食', emoji: '🍪', face: '🤤', weight: 2, effect: 'snack', energy: 4, mood: 'happy', scenes: null,
    diaries: ['我翻出了藏起来的小零食，就吃了一颗（真的只有一颗）。', '咔嚓咔嚓，零食时间最幸福了。'] },
  { id: 'chase', label: '追着尾巴转圈圈', emoji: '🌀', face: '😸', weight: 1.5, effect: 'butterfly', energy: -4, mood: 'playful', scenes: null,
    diaries: ['我追着自己的尾巴转了三圈，没追到，但很开心。', '一只蝴蝶路过了我的小世界，我追了它两步，没认真追。'] },
  { id: 'birdwatch', label: '趴着看窗外的小鸟', emoji: '🐦', face: '🧐', weight: 2, effect: '', energy: -1, mood: 'curious', scenes: ['window'],
    diaries: ['窗外的小鸟又来了，我们隔着一层玻璃对视了很久。', '我给窗台上的小鸟起了名字，不过这是秘密。'] },
  { id: 'stargaze', label: '仰头数星星', emoji: '✨', face: '😌', weight: 2.5, effect: '', energy: 1, mood: 'calm', scenes: ['night'],
    diaries: ['我数星星数到 27 颗就乱了，明天重新数。', '流星划过去的时候我许了个愿，愿望是你明天也来。'] },
  { id: 'wave', label: '蹲在岸边听浪花', emoji: '🌊', face: '😌', weight: 2.5, effect: '', energy: 1, mood: 'calm', scenes: ['seaside'],
    diaries: ['浪花一遍一遍地来，我一遍一遍地看，看不腻。', '海风有点咸，我打了个小喷嚏。'] },
  { id: 'roll', label: '在草地上打滚', emoji: '🌿', face: '😸', weight: 2.5, effect: '', energy: -3, mood: 'playful', scenes: ['grass'],
    diaries: ['我在草地上打了个滚，草的味道是春天的味道。', '打个滚，抖抖毛，就是一只全新的毛孩子了！'] },
  { id: 'lamp', label: '蹲在暖灯边取暖', emoji: '💡', face: '😴', weight: 2, effect: '', energy: 3, mood: 'calm', scenes: ['living'],
    diaries: ['暖黄的灯下面最舒服了，我蹲了好久好久。', '灯一闪一闪的，我看着看着就困了。'] }
];

const NAP = ACTIVITIES.filter((a) => a.id === 'nap')[0];
const ACTIVITY_BY_ID = ACTIVITIES.reduce((m, a) => { m[a.id] = a; return m; }, {});

// 性格偏置：贪吃更爱零食、活泼更爱疯、忠心更爱守着看风景
const PERSONALITY_BIAS = {
  foodie:   { snack: 2.5, stroll: 0.8, chase: 0.9 },
  lively:   { chase: 2.2, roll: 1.6, stroll: 1.3, nap: 0.7 },
  loyal:    { sightsee: 1.5, nap: 1.2, lamp: 1.3 },
  friendly: { daze: 1.4, sightsee: 1.2, roll: 1.2 }
};

// 互动 → 心情
const INTERACTION_MOOD = {
  touch: ['happy', 'shy'],
  feed:  ['happy', 'happy', 'playful'],
  play:  ['playful', 'playful', 'happy'],
  lift:  ['sulk', 'grumpy'],
  catch: ['shy', 'happy']
};
const INTERACTION_ENERGY = { feed: 6, play: -5, lift: -2 };

// 时段偏置：作息感
// 边界不在这里写——统一取 timeline.partAt。原先这套边界是 6/9/17/21/23，
// 和陪伴页场景的 5/9/17/20 差一截，结果 20:00 场景已经进了星空、
// 它却还停在「傍晚·开心」，中间空了一小时。现在两处共用一个源头。
const PART_BIAS = {
  // 深夜：只想睡，别的都提不起劲
  latenight: { nap: 3, daze: 1.4, chase: 0.4, snack: 0.6, mood: 'sleepy' },
  // 清晨（5 点起天就亮了，不再算深夜）
  dawn: { stroll: 1.6, sightsee: 1.4, mood: 'calm' },
  day: { chase: 1.4, roll: 1.4, stroll: 1.2, mood: 'playful' },
  dusk: { sightsee: 1.6, snack: 1.3, mood: 'happy' },
  // 入夜：安静下来，开始看星星
  evening: { stargaze: 2, nap: 1.6, mood: 'calm' }
};

function hourBias(h) {
  return PART_BIAS[timeline.partAt(h).id] || PART_BIAS.day;
}

// ---------- 纯计算层 ----------

function defaultState() {
  return { mood: 'happy', energy: 80, lastTick: Date.now(), lastVisit: 0, lastActivityId: '' };
}

function clampEnergy(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function moodMeta(key) {
  return MOODS[key] || MOODS.happy;
}

function weightedPick(items, rand) {
  const total = items.reduce((n, p) => n + p.w, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= items[i].w;
    if (r <= 0) return items[i].a;
  }
  return items[items.length - 1].a;
}

// 决定「接下来做什么」。纯函数：不读 storage、不调 Date.now（都可注入）。
// 返回 { activity, state, mood, diary }，diary 为 null 表示这次不记。
function rollActivity(opts) {
  const o = opts || {};
  const rand = o.rand || Math.random;
  const now = o.now || Date.now();
  const state = Object.assign(defaultState(), o.state || {});
  const hour = new Date(now).getHours();
  const bias = Object.assign({}, hourBias(hour), PERSONALITY_BIAS[o.personality] || {});

  let pool = ACTIVITIES.filter((a) => {
    if (a.scenes && a.scenes.indexOf(o.sceneId) < 0) return false;
    return a.id !== state.lastActivityId; // 不连着做同一件事
  });
  if (!pool.length) pool = ACTIVITIES.slice();

  const weighted = pool.map((a) => ({
    a,
    // 权重下限防止某个活动被乘到 0 之后永远不出现
    w: Math.max(0.1, a.weight * (bias[a.id] || 1) * (a.mood === state.mood ? 1.3 : 1))
  }));

  let activity = weightedPick(weighted, rand);
  let forced = false;
  // 能量见底时不让它去消耗性的活动，改成睡觉
  if (state.energy < 25 && activity.energy < 0) {
    activity = NAP;
    forced = true;
  }

  const next = Object.assign({}, state);
  next.energy = clampEnergy(state.energy + activity.energy);
  // 心情自然流动：55% 跟活动走，其余保持
  next.mood = rand() < 0.55 ? activity.mood : next.mood;
  // 夜深了更容易犯困
  const hb = hourBias(hour);
  if (hb.mood && rand() < 0.3) next.mood = hb.mood;
  next.lastActivityId = activity.id;
  next.lastTick = now;

  let diary = null;
  if (rand() < DIARY_WRITE_RATE) {
    diary = {
      activityId: activity.id,
      emoji: activity.emoji,
      text: activity.diaries[Math.floor(rand() * activity.diaries.length)],
      mood: activity.mood,
      scene: o.sceneId || '',
      createdAt: now
    };
  }

  return {
    activity,
    forced,
    state: next,
    mood: moodMeta(next.mood),
    moodKey: next.mood,
    diary
  };
}

// 它此刻正在做什么（给对话用："我刚在打盹呢"）
function activityLabelOf(state) {
  const a = ACTIVITY_BY_ID[(state && state.lastActivityId) || ''];
  return a ? a.label : '';
}

// 离线补记的文案规则也做成纯函数，方便断言边界（8 分钟 / 2 小时 / 12 小时）
function recapPlan(elapsed, rand) {
  const r = rand || Math.random;
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  if (elapsed < 8 * 60000) return null; // 刚离开一会儿，不算
  if (elapsed < 2 * 3600e3) {
    return [{ emoji: '💤', text: pick(['你不在的时候，我找了个舒服的角落打了个盹。', '刚才趴着眯了一会儿，耳朵一直听着门口。']), at: elapsed * 0.6 }];
  }
  if (elapsed < 12 * 3600e3) {
    return [
      { emoji: '🐾', text: pick(['你不在的时候，我在小世界里溜达了一大圈。', '我沿着墙根走了一遍，把每个角落都闻过了。']), at: elapsed * 0.7 },
      { emoji: '🍪', text: '然后我偷偷啃了颗小零食，补充体力等你回来。', at: elapsed * 0.45 },
      { emoji: '😴', text: '刚才我有点困，正打盹呢，你就回来了！', at: 5 * 60000 }
    ];
  }
  return [
    { emoji: '🌄', text: pick(['你不在的这些天，我每天都会去看看风景，等你出现。', '这几天我把能看的风景都看了一遍，还是想等你一起看。']), at: elapsed * 0.75 },
    { emoji: '🎾', text: '我把小球滚到沙发底下又够出来，玩了好几回。', at: elapsed * 0.5 },
    { emoji: '💭', text: '睡觉前我想你了，就把自己卷成了一团。', at: 3 * 60000 }
  ];
}

// ---------- 存储层 ----------

function readState() {
  let s = null;
  try { s = wx.getStorageSync(STATE_KEY); } catch (e) { s = null; }
  return Object.assign(defaultState(), (s && typeof s === 'object') ? s : {});
}

function writeState(s) {
  try { wx.setStorageSync(STATE_KEY, s); } catch (e) { /* 存储满或被禁用时不影响主流程 */ }
  return s;
}

function getState() {
  return readState();
}

function getDiaryList() {
  try { return wx.getStorageSync(DIARY_KEY) || []; } catch (e) { return []; }
}

function saveDiaryList(list) {
  try { wx.setStorageSync(DIARY_KEY, list.slice(0, KEEP_DIARY)); } catch (e) { /* ignore */ }
}

function appendDiary(entry, list) {
  const arr = list || getDiaryList();
  // 同一活动短时间重复触发时不重复记账
  if (entry.activityId !== 'recap') {
    const dup = arr.find((d) => d.activityId === entry.activityId && entry.createdAt - d.createdAt < SAME_ACTIVITY_GAP);
    if (dup) return arr;
  }
  const item = Object.assign({ _id: 'd' + entry.createdAt + '-' + arr.length, scene: '' }, entry);
  arr.unshift(item);
  saveDiaryList(arr);
  return arr;
}

// 演一次自主活动：读一次 state，算完写回，需要时记日记
function pickActivity(sceneId, personality) {
  const state = readState();
  const rolled = rollActivity({ sceneId, personality, state });
  writeState(rolled.state);
  if (rolled.diary) appendDiary(rolled.diary);

  const activity = rolled.activity;
  // 打盹、啃零食冒个短气泡，别的活动只改状态文案
  let bubble = '';
  if (activity.id === 'nap') bubble = 'Zzz…';
  else if (activity.id === 'snack') bubble = '咔嚓咔嚓…';

  return {
    activity,
    state: rolled.state,
    mood: rolled.mood,
    moodKey: rolled.moodKey,
    wroteDiary: !!rolled.diary,
    bubble
  };
}

// 互动改变心情：喂食回体力、玩耍费体力、被拎会委屈
function onInteraction(kind) {
  const s = readState();
  s.mood = randomFrom(INTERACTION_MOOD[kind] || ['happy']);
  s.energy = clampEnergy(s.energy + (INTERACTION_ENERGY[kind] || 2));
  s.lastTick = Date.now();
  return writeState(s);
}

// 离线补记：你不在的这段时间它也没闲着
function offlineRecap() {
  const s = readState();
  const elapsed = Date.now() - (s.lastVisit || s.lastTick || Date.now());
  const plan = recapPlan(elapsed, Math.random);
  s.lastVisit = Date.now();
  s.mood = 'happy'; // 见到你总是开心的
  if (plan) {
    // 睡了一觉，体力回升，但不直接满格
    s.energy = clampEnergy(s.energy + Math.min(40, Math.round(elapsed / 60000)));
    const list = getDiaryList();
    plan.forEach((e, i) => {
      list.unshift({
        _id: 'd' + (Date.now() + i),
        activityId: 'recap',
        emoji: e.emoji,
        text: e.text,
        scene: '',
        createdAt: Date.now() - Math.round(e.at)
      });
    });
    saveDiaryList(list);
  }
  writeState(s);
  return (plan || []).map((e) => ({ emoji: e.emoji, text: e.text, agoText: timeAgo(Date.now() - e.at) }));
}

// 离开页面时打个点。离线补记靠它算「你走了多久」——
// 只靠 offlineRecap 自己记时间不行：页面还在前台但用户切走了，回来时差是 0。
function markLeave() {
  const s = readState();
  s.lastVisit = Date.now();
  return writeState(s);
}

// 它自己溜达到别的场景，也要留下痕迹
function writeRoamDiary(scene) {
  if (!scene || !scene.id) return;
  appendDiary({
    activityId: 'roam-' + scene.id,
    emoji: scene.icon || '🐾',
    text: randomFrom([
      '我自己溜达到' + scene.name + '啦，这里也不错哦。',
      '走着走着就到了' + scene.name + '，跟着鼻子走的。'
    ]),
    scene: scene.id,
    createdAt: Date.now()
  });
}

function decorateDiary(limit) {
  return getDiaryList().slice(0, limit || 10).map((d) => Object.assign({}, d, {
    timeText: timeAgo(d.createdAt)
  }));
}

// 给「我的」页/对话页用的一行摘要
function summary() {
  const s = readState();
  const m = moodMeta(s.mood);
  return {
    mood: s.mood,
    moodLabel: m.label,
    moodFace: m.face,
    moodText: moodTextOf(s.mood),
    energy: s.energy,
    activityLabel: activityLabelOf(s)
  };
}

// 删除宠物 / 清空数据时调用
function reset() {
  try { wx.removeStorageSync(STATE_KEY); } catch (e) { /* ignore */ }
  try { wx.removeStorageSync(DIARY_KEY); } catch (e) { /* ignore */ }
}

module.exports = {
  MOODS,
  MOOD_TEXT: chatBrain.MOOD_TEXT,
  ACTIVITIES,
  // 纯函数（可单测）
  rollActivity,
  recapPlan,
  activityLabelOf,
  moodMeta,
  defaultState,
  // 带存储的封装
  getState,
  pickActivity,
  onInteraction,
  offlineRecap,
  writeRoamDiary,
  markLeave,
  getDiaryList,
  decorateDiary,
  summary,
  reset
};
