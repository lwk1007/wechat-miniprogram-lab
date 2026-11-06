// 「一起生活的第 N 天」
//
// 数据全部来自已有字段，不新增任何存储：
//   pet.sinceDate  用户选的起算日（可以选到过去，比如「我从 2023 年就养它了」）
//   pet.createdAt  建档时间，sinceDate 没填时兜底
//   moments        按天的互动记录，算活跃天数和连续天数
//
// 全是纯函数，时间可以注入，测试不用打桩。

const moments = require('./moments');

// 里程碑：越往后越稀疏，免得第 200 天到 365 天之间半年没有反馈
const MILESTONES = [1, 7, 14, 30, 60, 100, 180, 365, 500, 730, 1000, 1825];

// 把日期归一化到「UTC 的整数天」再相减。
// 直接拿毫秒差除以 86400e3 会踩时区和夏令时：跨一次 23 或 25 小时的边界，
// 天数就少算或多算一天。
function dayIndex(d) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400e3);
}

// '2026-08-14' 手动拆，不能用 new Date(str)：
// 带连字符的日期串会被当成 UTC 零点解析，东八区再取 getDate() 会退回前一天。
function parseYmd(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return 0;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  const dt = new Date(y, mo - 1, d);
  // '2026-02-31' 会被 Date 自动滚到 3 月 3 日，回读校验才能拦住
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return 0;
  return dt.getTime();
}

// 起算时间：sinceDate 优先，没有就用建档时间
function startAt(pet) {
  const since = parseYmd(pet && pet.sinceDate);
  if (since) return since;
  const created = (pet && pet.createdAt) || 0;
  return created > 0 ? created : 0;
}

// 第几天：见面当天算第 1 天，不是第 0 天
function daysTogether(pet, now) {
  const s = startAt(pet);
  if (!s) return 0;
  const t = now == null ? Date.now() : now;
  const n = dayIndex(new Date(t)) - dayIndex(new Date(s)) + 1;
  // sinceDate 被填成未来（脏数据）时兜到第 1 天，不要显示负数
  return n > 0 ? n : 1;
}

// 当前处在哪两个里程碑之间。
// progress 按「上一档 → 下一档」的区间算，不是 days / next：
// 否则第 8 天到第 14 天之间进度条会从 57% 一路走到 93%，看着快满了其实才刚开始
function milestoneOf(days) {
  let reached = 0;
  let prev = 0;
  let next = 0;
  for (let i = 0; i < MILESTONES.length; i++) {
    if (days >= MILESTONES[i]) {
      reached = MILESTONES[i];
      prev = MILESTONES[i];
    } else {
      next = MILESTONES[i];
      break;
    }
  }
  const span = next - prev;
  return {
    reached,
    next,
    toNext: next ? next - days : 0,
    progress: next && span > 0 ? Math.min(1, (days - prev) / span) : 1
  };
}

// 连续陪伴：往回数，最多数 3660 天（10 年），防脏数据把循环卡死
function streakOf(dayMap, now) {
  if (!dayMap || typeof dayMap !== 'object') return 0;
  const cursor = new Date(now == null ? Date.now() : now);
  // 今天还没互动就从昨天开始数。
  // 不这么写的话，每天早上刚打开会显示「连续 0 天」，等于把用户攒的记录清零。
  if (!dayMap[moments.dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (n < 3660 && dayMap[moments.dayKey(cursor)]) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

// 2026年8月14日
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

function summary(pet, now) {
  const m = moments.summary();
  const days = daysTogether(pet, now);
  const start = startAt(pet);
  return {
    days,
    startAt: start,
    startText: fmtDate(start),
    milestone: milestoneOf(days),
    activeDays: m.activeDays || 0,
    streak: streakOf(m.dayMap, now),
    total: m.total || 0,
    feed: m.feed || 0,
    play: m.play || 0,
    touch: m.touch || 0,
    lift: m.lift || 0
  };
}

module.exports = {
  MILESTONES,
  dayIndex,
  parseYmd,
  startAt,
  daysTogether,
  milestoneOf,
  streakOf,
  fmtDate,
  summary
};
