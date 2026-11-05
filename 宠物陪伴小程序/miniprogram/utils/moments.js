// 近期互动记录：给「AI 总结一封信」提供真实素材
// 只存在本机，30 天自动过期。写信时随请求上报的是汇总值（次数/天数），不是明细
const KEY = 'pet_moments';
const KEEP_DAYS = 30;

const SCENE_NAME = { grass: '草地', window: '窗台', living: '客厅', seaside: '海边', night: '星空' };
const KINDS = ['feed', 'play', 'touch', 'lift'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function dayKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function today() { return dayKey(new Date()); }
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

function empty() {
  return { feed: 0, play: 0, touch: 0, lift: 0, scenes: {}, days: {}, firstAt: 0, lastAt: 0 };
}

function read() {
  try {
    const v = wx.getStorageSync(KEY);
    if (!v || typeof v !== 'object') return empty();
    return Object.assign(empty(), v);
  } catch (e) {
    return empty();
  }
}

function write(s) {
  try { wx.setStorageSync(KEY, s); } catch (e) { /* 存储满了就放弃统计，不影响主流程 */ }
}

function stamp(s) {
  const now = Date.now();
  if (!s.firstAt) s.firstAt = now;
  s.lastAt = now;
  s.days[today()] = true;
}

// 喂食 / 玩耍 / 摸摸 / 被拎起来
function bump(kind) {
  if (KINDS.indexOf(kind) < 0) return;
  const s = read();
  s[kind] = (s[kind] || 0) + 1;
  stamp(s);
  write(s);
}

function bumpScene(id) {
  if (!id) return;
  const s = read();
  s.scenes[id] = (s.scenes[id] || 0) + 1;
  stamp(s);
  write(s);
}

// 只保留最近 30 天活跃过的日子，老数据自然过期
function prune(s) {
  const limit = dayOffset(-KEEP_DAYS);
  const days = s.days || {};
  Object.keys(days).forEach((d) => { if (d < limit) delete days[d]; });
  s.days = days;
  if (s.lastAt && Date.now() - s.lastAt > KEEP_DAYS * 86400e3) {
    // 超过 30 天没来过：次数也一起清掉，避免"信里写着很早以前的数字"
    const fresh = empty();
    Object.keys(fresh).forEach((k) => { s[k] = fresh[k]; });
  }
  return s;
}

function summary() {
  const s = prune(read());
  const sceneIds = Object.keys(s.scenes || {}).sort((a, b) => s.scenes[b] - s.scenes[a]);
  const spanDays = s.firstAt ? Math.max(1, Math.ceil((Date.now() - s.firstAt) / 86400e3)) : 0;
  return {
    feed: s.feed || 0,
    play: s.play || 0,
    touch: s.touch || 0,
    lift: s.lift || 0,
    total: (s.feed || 0) + (s.play || 0) + (s.touch || 0) + (s.lift || 0),
    activeDays: Object.keys(s.days || {}).length,
    sceneCount: sceneIds.length,
    scenes: sceneIds.slice(0, 3).map((id) => SCENE_NAME[id] || id),
    firstAt: s.firstAt || 0,
    lastAt: s.lastAt || 0,
    spanDays
  };
}

// 清空：真的删掉存储项，而不是写入一份全零记录
function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* 存储不可用时忽略 */ }
}

// 信纸落款用的日期：2026年11月5日
function todayText() {
  const d = new Date();
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

module.exports = { bump, bumpScene, summary, reset, todayText, SCENE_NAME };
