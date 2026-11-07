// 心情日志：记录每天对它的思念
//
// 借鉴：
//   · Daily_You（1.4k★）——每日记录 + 心情 + 日历回看，随机提醒鼓励坚持
//   · pixy-mood-tracker（155★）——「一年一像素」情绪色块地图，极简优雅
//   · anchor——循证的温和短语（安抚低落情绪），离线、无账号
//
// 一天一条，按天覆盖。数据只在本机，不上传。
// 伦理边界：这是「你」对它的情感记录，不是宠物回复，不碰「AI 冒充宠物」。
//
// 分层：纯函数（monthCells / sootheText / buildSummary）可单测，
//       存储层薄封装读写 wx Storage。

const { dayKey } = require('./moments');

const KEY = 'pet_moods';

// 心情标签：贴合「思念宠物」场景，而非通用 mood
const MOODS = {
  missing:  { label: '想念', face: '🥺', color: '#A5BFD9' },
  sad:      { label: '难过', face: '😢', color: '#9BA8B8' },
  calm:     { label: '平静', face: '😌', color: '#A8C9A8' },
  happy:    { label: '开心', face: '😊', color: '#E8C87D' },
  grateful: { label: '感恩', face: '💗', color: '#DEA0A0' }
};

const MOOD_KEYS = Object.keys(MOODS);

// 安抚文案：一句温和的话（呼应 anchor 的「准备阶段」——先接纳、再安抚）
const SOOTHE = {
  missing:  '有些陪伴，不会因为不在身边就消失。它记得你的手，记得你的声音。',
  sad:      '难过是被允许的。你对它的思念，恰恰说明它曾真实地存在过、被爱过。',
  calm:     '此刻的平静很好。它一定也希望你好好照顾自己。',
  happy:    '想起它的时候能笑出来，这份快乐，是它留给你的礼物。',
  grateful: '谢谢你记得它。被记住，就是它还在的证明。'
};

// 呼吸引导（box breathing 4-4-4-4，借鉴 calmspace 的呼吸引导）
const BREATH = {
  rounds: 3,
  steps: [
    { label: '吸气', secs: 4 },
    { label: '屏住', secs: 4 },
    { label: '呼气', secs: 4 },
    { label: '屏住', secs: 4 }
  ]
};

// ---------- 纯函数 ----------

// 安抚文案：低落情绪（想念/难过）单独语气，其余也有对应回应
function sootheText(mood) {
  return SOOTHE[mood] || SOOTHE.calm;
}

// 是否需要安抚：想念/难过视为低落
function needsSoothing(mood) {
  return mood === 'missing' || mood === 'sad';
}

// 月历网格：某年某月的每一天 + 心情，供日历色块视图用
// log = { 'YYYY-MM-DD': { mood, note, createdAt } }；now 用于标「今天」
function monthCells(year, month, log, now) {
  const logMap = log || {};
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = (first.getDay() + 6) % 7; // 周一 = 0，中文日历习惯周一开头
  const todayKey = dayKey(new Date(now == null ? Date.now() : now));
  const cells = [];

  for (let i = 0; i < startWeekday; i++) {
    cells.push({ day: 0, mood: '', face: '', color: '', blank: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const k = dayKey(new Date(year, month - 1, d));
    const rec = logMap[k];
    const meta = rec && MOODS[rec.mood];
    cells.push({
      day: d,
      mood: rec ? rec.mood : '',
      face: meta ? meta.face : '',
      color: meta ? meta.color : '',
      note: rec ? (rec.note || '') : '',
      isToday: k === todayKey,
      blank: false
    });
  }
  return cells;
}

// 统计：总天数、各心情计数、最近一次记录
function buildSummary(log) {
  const logMap = log || {};
  const counts = {};
  MOOD_KEYS.forEach((k) => { counts[k] = 0; });
  let days = 0;
  let lastMood = '';
  let lastAt = 0;
  Object.keys(logMap).forEach((k) => {
    const rec = logMap[k];
    days++;
    if (rec && MOODS[rec.mood]) counts[rec.mood]++;
    if (rec && rec.createdAt > lastAt) {
      lastAt = rec.createdAt;
      lastMood = rec.mood;
    }
  });
  return { days, counts, lastMood, lastAt };
}

// ---------- 存储层 ----------

function read() {
  try {
    const v = wx.getStorageSync(KEY);
    return (v && typeof v === 'object') ? v : {};
  } catch (e) {
    return {};
  }
}

function write(map) {
  try { wx.setStorageSync(KEY, map); } catch (e) { /* ignore */ }
}

function getLog() {
  return read();
}

function getToday(now) {
  const map = read();
  const k = dayKey(new Date(now == null ? Date.now() : now));
  return map[k] || null;
}

// 记录今天的心情（覆盖当天已有），返回写入后的记录
function setToday(mood, note, now) {
  if (MOOD_KEYS.indexOf(mood) < 0) return null;
  const map = read();
  const k = dayKey(new Date(now == null ? Date.now() : now));
  map[k] = {
    mood,
    note: String(note == null ? '' : note).slice(0, 120),
    createdAt: now == null ? Date.now() : now
  };
  write(map);
  return map[k];
}

// 最近 N 天有记录的日子（倒序）
function recent(days, now) {
  const map = read();
  const out = [];
  const cursor = new Date(now == null ? Date.now() : now);
  for (let i = 0; i < (days || 30); i++) {
    const k = dayKey(cursor);
    if (map[k]) out.push(Object.assign({ key: k }, map[k]));
    cursor.setDate(cursor.getDate() - 1);
  }
  return out;
}

function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* ignore */ }
}

module.exports = {
  MOODS,
  MOOD_KEYS,
  SOOTHE,
  BREATH,
  sootheText,
  needsSoothing,
  monthCells,
  buildSummary,
  getLog,
  getToday,
  setToday,
  recent,
  reset
};
