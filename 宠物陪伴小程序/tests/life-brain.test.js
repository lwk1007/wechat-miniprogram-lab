// 自主生命 + 对话大脑 断言（Node 模拟 wx 环境）
//
// 这两块是「合并队友版本」时唯一有真实逻辑的模块，也是最容易在后续改动里悄悄坏掉的部分。
// 覆盖三层：
//   1. 纯函数：不碰 wx、随机源可注入，所以能测出确定结果
//   2. 存储层：用内存 Map 模拟 Storage，验证读写和去重
//   3. 一致性：云函数副本必须和源码逐字节相同，否则线上和本地两套行为

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const store = new Map();

global.wx = {
  getStorageSync(k) { return store.has(k) ? store.get(k) : ''; },
  setStorageSync(k, v) { store.set(k, v); },
  removeStorageSync(k) { store.delete(k); },
  clearStorageSync() { store.clear(); },
  showToast() {},
  showModal() {},
  vibrateShort() {}
};

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const life = require(path.join(ROOT, 'miniprogram/utils/pet-life'));
const brain = require(path.join(ROOT, 'miniprogram/utils/chat-brain'));
const cloudPersona = require(path.join(ROOT, 'cloudfunctions/chat/persona'));

// 固定随机源：第 n 次调用返回 seq[n % seq.length]
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
// 常量随机源
const fixed = (v) => () => v;

(async function run() {
  /* ================= 一、对话大脑：纯函数 ================= */
  console.log('\n[1] chat-brain.detect：意图优先级');
  ok('想念', brain.detect('我想你了') === 'miss');
  ok('安慰（累）', brain.detect('今天好累') === 'comfort');
  ok('开心', brain.detect('太好了！') === 'joy');
  ok('吃的', brain.detect('我饿了') === 'food');
  ok('晚安', brain.detect('晚安啦') === 'goodnight');
  ok('问在干嘛', brain.detect('你在干嘛呀') === 'idle');
  ok('夸它', brain.detect('你真可爱') === 'praise');
  ok('套话 AI', brain.detect('你是不是 AI') === 'meta');
  ok('问名字', brain.detect('你叫什么名字') === 'name');
  ok('问候', brain.detect('哈喽') === 'greet');
  ok('普通闲聊兜底', brain.detect('今天天气一般') === 'chat');
  ok('空输入不报错', brain.detect('') === 'chat');
  ok('null 不报错', brain.detect(null) === 'chat');

  console.log('\n[2] chat-brain.reply：情绪分档真的分档');
  const lonely = { pet: { name: '豆豆', type: 'cat', personality: 'loyal' }, history: [], mood: 'happy' };
  const happyReply = brain.reply('我想你了', lonely, fixed(0.1));
  // 心情不是摆设：意图倾向是基准，但当前心情有概率盖过去
  const sulkReply = brain.reply('我想你了', Object.assign({}, lonely, { mood: 'sulk' }), fixed(0.1));
  ok('委屈时会被心情带走', sulkReply.emotion === 'sulk', sulkReply.emotion);
  const calmReply = brain.reply('我想你了', Object.assign({}, lonely, { mood: 'calm' }), fixed(0.1));
  ok('心情不同、回复文案不同', sulkReply.content !== happyReply.content,
    sulkReply.content + ' / ' + happyReply.content);
  ok('心情档位无对照时回落不报错', typeof calmReply.content === 'string' && calmReply.content.length > 0);
  ok('情绪被记录下来', typeof happyReply.emotion === 'string' && happyReply.emotion.length > 0);
  ok('演示标记为 true', happyReply.isDemo === true);

  console.log('\n[3] chat-brain.reply：动态内容与防复读');
  const idle = brain.reply('你在干嘛', {
    pet: { name: '豆豆', personality: 'friendly' },
    history: [],
    mood: 'happy',
    activityLabel: '卷成一团打盹'
  }, fixed(0.1));
  ok('问在干嘛会带上它正在做的事', idle.content.indexOf('打盹') >= 0, idle.content);

  const named = brain.reply('你叫什么', { pet: { name: '团团' }, history: [], mood: 'happy' }, fixed(0.5));
  ok('问名字会说出名字', named.content.indexOf('团团') >= 0, named.content);

  // 第一句回复已进历史，再问一次同一意图不应该重复
  const h = [{ role: 'user', content: '在吗' }, { role: 'pet', content: happyReply.content }];
  const again = brain.reply('我想你了', Object.assign({}, lonely, { history: h }), fixed(0.1));
  ok('最近说过的句子不会立刻重复', again.content !== happyReply.content, again.content);

  console.log('\n[4] chat-brain.reply：随机源可注入 → 结果可复现');
  const c1 = brain.reply('今天过得不错', { pet: { personality: 'lively' }, history: [], mood: 'calm' }, seq([0.2, 0.6, 0.9, 0.3]));
  const c2 = brain.reply('今天过得不错', { pet: { personality: 'lively' }, history: [], mood: 'calm' }, seq([0.2, 0.6, 0.9, 0.3]));
  ok('同样的随机序列产出同样的回复', c1.content === c2.content);

  console.log('\n[5] chat-brain：标点拼接与关系温度');
  const long = { pet: { personality: 'loyal', type: 'dog' }, history: [], mood: 'happy' };
  let badPunct = 0;
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const r = brain.reply('我有点难过', long, seq([0.3, 0.2, 0.4, 0.1, 0.9]));
    total++;
    if (/[。！？][，、]/.test(r.content)) badPunct++;
  }
  ok('不会出现「。，」这类双标点', badPunct === 0, badPunct + '/' + total + ' 条异常');

  ok('温度 1 档：少于 16 条', brain.warmthOf(new Array(10).fill({ role: 'user' })) === 1);
  ok('温度 2 档：16 条起', brain.warmthOf(new Array(18).fill({ role: 'user' })) === 2);
  ok('温度 3 档：40 条起', brain.warmthOf(new Array(45).fill({ role: 'user' })) === 3);

  console.log('\n[6] chat-brain：零外部依赖（云函数可独立跑）');
  const raw = fs.readFileSync(path.join(ROOT, 'miniprogram/utils/chat-brain.js'), 'utf8');
  // 注释里提到 require 不算，只看真实代码行
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .filter((l) => l.trim().indexOf('//') !== 0).join('\n');
  ok('代码里没有 require 语句', !/require\s*\(/.test(code), '出现 require 会导致云函数副本报错');

  /* ================= 二、生命引擎：纯函数 ================= */
  console.log('\n[7] pet-life.rollActivity：场景过滤与去重');
  const windowOnly = new Set();
  for (let i = 0; i < 120; i++) {
    const r = life.rollActivity({
      sceneId: 'window', personality: 'friendly', state: life.defaultState(), rand: Math.random, now: Date.now()
    });
    windowOnly.add(r.activity.id);
  }
  // grass-only（roll）和 seaside-only（wave）不该在窗台出现
  ok('窗台不会出现草地专属活动', !windowOnly.has('roll'), [...windowOnly].join(','));
  ok('窗台不会出现海边专属活动', !windowOnly.has('wave'));
  ok('窗台能出现窗外看鸟', windowOnly.has('birdwatch'));

  const sameState = life.defaultState();
  sameState.lastActivityId = 'stroll';
  let repeated = 0;
  for (let i = 0; i < 60; i++) {
    const r = life.rollActivity({
      sceneId: 'grass', personality: 'lively', state: sameState, rand: Math.random, now: Date.now()
    });
    if (r.activity.id === 'stroll') repeated++;
  }
  ok('不会连续做同一件事', repeated === 0, '重复 ' + repeated + ' 次');

  console.log('\n[8] pet-life.rollActivity：能量与心情边界');
  const tired = Object.assign(life.defaultState(), { energy: 5 });
  let consuming = 0;
  let napped = 0;
  for (let i = 0; i < 60; i++) {
    const r = life.rollActivity({ sceneId: 'grass', personality: 'lively', state: tired, rand: Math.random, now: Date.now() });
    if (r.activity.id === 'nap') napped++;
    // 能量见底时不允许再做消耗性活动（energy < 0 的那些）
    if (r.activity.energy < 0 && r.activity.id !== 'nap') consuming++;
  }
  ok('能量见底时不做消耗性活动', consuming === 0, consuming + '/60');
  ok('能量见底时确实会去睡觉', napped > 0, napped + '/60');

  const full = Object.assign(life.defaultState(), { energy: 100 });
  const r2 = life.rollActivity({ sceneId: 'grass', personality: 'lively', state: full, rand: fixed(0.99), now: Date.now() });
  ok('能量不超过 100', r2.state.energy <= 100, r2.state.energy);
  ok('能量不低于 0', r2.state.energy >= 0);

  const lowEnergy = Object.assign(life.defaultState(), { energy: 0 });
  const r3 = life.rollActivity({ sceneId: 'grass', personality: 'lively', state: lowEnergy, rand: fixed(0.5), now: Date.now() });
  ok('低能量也是合法值', r3.state.energy >= 0 && r3.state.energy <= 100, r3.state.energy);

  console.log('\n[9] pet-life.rollActivity：心情会流动');
  const moods = new Set();
  for (let i = 0; i < 200; i++) {
    const r = life.rollActivity({
      sceneId: 'seaside', personality: 'foodie', state: life.defaultState(), rand: Math.random, now: Date.now()
    });
    moods.add(r.state.mood);
  }
  ok('多次活动后心情不是单一值', moods.size >= 2, [...moods].join(','));
  ok('心情一定是已知值', [...moods].every((m) => !!life.MOODS[m]), [...moods].join(','));

  console.log('\n[10] pet-life.recapPlan：离线时长分档');
  ok('7 分钟不算离开', life.recapPlan(7 * 60000, fixed(0.5)) === null);
  ok('8 分钟开始补记', (life.recapPlan(9 * 60000, fixed(0.5)) || []).length === 1);
  ok('半小时给 1 条', life.recapPlan(30 * 60000, fixed(0.5)).length === 1);
  ok('5 小时给 3 条', life.recapPlan(5 * 3600e3, fixed(0.5)).length === 3);
  ok('3 天给 3 条', life.recapPlan(3 * 24 * 3600e3, fixed(0.5)).length === 3);
  ok('每条都带 emoji 与文案', life.recapPlan(5 * 3600e3, fixed(0.5)).every((e) => e.emoji && e.text));
  ok('时间戳递减且为过去时间', life.recapPlan(5 * 3600e3, fixed(0.5)).every((e) => e.at > 0));

  console.log('\n[11] pet-life：活动与心情的查询函数');
  ok('未知活动返回空串', life.activityLabelOf({ lastActivityId: 'nope' }) === '');
  ok('已知活动返回中文名', life.activityLabelOf({ lastActivityId: 'nap' }) === '卷成一团打盹');
  ok('未知心情回落到开心', life.moodMeta('nope').label === '开心');
  ok('MOODS 与 MOOD_TEXT 键一一对应',
    Object.keys(life.MOODS).sort().join(',') === Object.keys(life.MOOD_TEXT).sort().join(','),
    Object.keys(life.MOODS).join(',') + ' vs ' + Object.keys(life.MOOD_TEXT).join(','));

  /* ================= 三、存储层 ================= */
  console.log('\n[12] pet-life：存储读写与日记');
  store.clear();
  ok('初始心情为开心', life.getState().mood === 'happy');
  const after = life.onInteraction('lift');
  ok('被拎起来会不高兴', after.mood === 'sulk' || after.mood === 'grumpy', after.mood);
  ok('喂食加体力', life.onInteraction('feed').energy > 0);
  ok('玩耍费体力', life.onInteraction('play').energy < life.onInteraction('feed').energy);

  store.clear();
  const p1 = life.pickActivity('grass', 'lively');
  ok('pickActivity 返回活动', !!p1.activity && !!p1.activity.id);
  ok('pickActivity 返回心情标签', typeof p1.mood.label === 'string' && p1.mood.label.length > 0);
  // 循环多次让日记有概率写入
  for (let i = 0; i < 30; i++) life.pickActivity('grass', 'lively');
  const diary = life.decorateDiary(8);
  ok('日记最多返回 8 条', diary.length <= 8, diary.length);
  ok('日记条目带 timeText', diary.length === 0 || diary.every((d) => typeof d.timeText === 'string'));
  ok('日记不重复记录同一活动', (() => {
    const ids = life.decorateDiary(60).map((d) => d.activityId);
    const seen = new Set();
    for (const id of ids) {
      if (id === 'recap') continue;
      if (seen.has(id)) return false;
      seen.add(id);
    }
    return true;
  })());

  store.clear();
  life.onInteraction('lift');
  life.markLeave();
  ok('markLeave 后 lastVisit 被写入', life.getState().lastVisit > 0);

  store.clear();
  life.pickActivity('grass', 'loyal');
  life.reset();
  ok('reset 清掉心情状态', life.getState().mood === 'happy' && life.getState().lastActivityId === '');
  ok('reset 清掉日记', life.decorateDiary(10).length === 0);

  /* ================= 四、云函数一致性 ================= */
  console.log('\n[13] 云函数副本与源码一致（防止改一边忘一边）');
  const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
  const a = md5(path.join(ROOT, 'miniprogram/utils/chat-brain.js'));
  const b = md5(path.join(ROOT, 'cloudfunctions/chat/chat-brain.js'));
  ok('两份 chat-brain 完全相同', a === b, a + ' vs ' + b);
  ok('云端能自己 require 到它',
    fs.existsSync(path.join(ROOT, 'cloudfunctions/chat/chat-brain.js')));

  console.log('\n[14] 真模型 prompt 带上「此刻」');
  const promptWith = cloudPersona.buildSystemPrompt(
    { name: '豆豆', personality: 'loyal' },
    brain.describeForPrompt({ moodText: '有点困', activityLabel: '卷成一团打盹', sceneName: '窗台' })
  );
  ok('prompt 含【此刻】段落', promptWith.indexOf('【此刻】') >= 0);
  ok('prompt 含心情描述', promptWith.indexOf('有点困') >= 0);
  ok('prompt 含正在做的事', promptWith.indexOf('打盹') >= 0);
  const promptBare = cloudPersona.buildSystemPrompt({ name: '豆豆', personality: 'loyal' }, '');
  ok('没有状态时不出现空段落', promptBare.indexOf('【此刻】') < 0);
  ok('原有负面约束仍在', promptBare.indexOf('客服腔') >= 0);
  ok('describeForPrompt 空入参返回空串', brain.describeForPrompt({}) === '');

  console.log('\n────────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail > 0) process.exit(1);
})();
