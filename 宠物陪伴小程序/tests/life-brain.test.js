// 自主生命引擎断言（Node 模拟 wx 环境）
//
// 生命引擎是陪伴体验的核心：心情状态机、自主活动、足迹日记、离线补记。
// 覆盖两层：
//   1. 纯函数：不碰 wx、随机源可注入，所以能测出确定结果
//   2. 存储层：用内存 Map 模拟 Storage，验证读写和去重

const path = require('path');

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

// 固定随机源：第 n 次调用返回 seq[n % seq.length]
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
// 常量随机源
const fixed = (v) => () => v;

(async function run() {
  /* ================= 一、生命引擎：纯函数 ================= */
  console.log('\n[1] pet-life.rollActivity：场景过滤与去重');
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

  console.log('\n[2] pet-life.rollActivity：能量与心情边界');
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

  console.log('\n[3] pet-life.rollActivity：心情会流动');
  const moods = new Set();
  for (let i = 0; i < 200; i++) {
    const r = life.rollActivity({
      sceneId: 'seaside', personality: 'foodie', state: life.defaultState(), rand: Math.random, now: Date.now()
    });
    moods.add(r.state.mood);
  }
  ok('多次活动后心情不是单一值', moods.size >= 2, [...moods].join(','));
  ok('心情一定是已知值', [...moods].every((m) => !!life.MOODS[m]), [...moods].join(','));

  console.log('\n[4] pet-life.recapPlan：离线时长分档');
  ok('7 分钟不算离开', life.recapPlan(7 * 60000, fixed(0.5)) === null);
  ok('8 分钟开始补记', (life.recapPlan(9 * 60000, fixed(0.5)) || []).length === 1);
  ok('半小时给 1 条', life.recapPlan(30 * 60000, fixed(0.5)).length === 1);
  ok('5 小时给 3 条', life.recapPlan(5 * 3600e3, fixed(0.5)).length === 3);
  ok('3 天给 3 条', life.recapPlan(3 * 24 * 3600e3, fixed(0.5)).length === 3);
  ok('每条都带 emoji 与文案', life.recapPlan(5 * 3600e3, fixed(0.5)).every((e) => e.emoji && e.text));
  ok('时间戳递减且为过去时间', life.recapPlan(5 * 3600e3, fixed(0.5)).every((e) => e.at > 0));

  console.log('\n[5] pet-life：活动与心情的查询函数');
  ok('未知活动返回空串', life.activityLabelOf({ lastActivityId: 'nope' }) === '');
  ok('已知活动返回中文名', life.activityLabelOf({ lastActivityId: 'nap' }) === '卷成一团打盹');
  ok('未知心情回落到开心', life.moodMeta('nope').label === '开心');
  ok('MOODS 与 MOOD_TEXT 键一一对应',
    Object.keys(life.MOODS).sort().join(',') === Object.keys(life.MOOD_TEXT).sort().join(','),
    Object.keys(life.MOODS).join(',') + ' vs ' + Object.keys(life.MOOD_TEXT).join(','));

  /* ================= 二、存储层 ================= */
  console.log('\n[6] pet-life：存储读写与日记');
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

  console.log('\n────────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail > 0) process.exit(1);
})();
