// 时间的唯一出口：一天怎么分档、此刻该去哪、天黑了没。
//
// 之前三处各写一套边界（桌面页 19/6、陪伴页 5/9/17/20、宠物作息 6/9/17/21/23），
// 后果是 20:00 场景已经判成「星空」，宠物却还停在 17–21 的开心档。
// 现在统一从这里取，页面和云函数都不再自己数小时。

// 一天分五档。scene 是「没必要选择时默认去哪」，不是「只能去哪」——
// 用户随时可以自己点别的场景，这里只负责兜底。
const DAYPARTS = [
  { id: 'latenight', from: 23, to: 5, scene: 'night' },
  { id: 'dawn', from: 5, to: 9, scene: 'window' },
  { id: 'day', from: 9, to: 17, scene: 'grass' },
  { id: 'dusk', from: 17, to: 20, scene: 'seaside' },
  { id: 'evening', from: 20, to: 23, scene: 'night' }
];

// 天黑比「该去哪」早一小时：19 点天已经暗了，但还没到非进星空不可的时候。
// 两个维度必须分开，否则会出现「19:30 在客厅，却按夜间算」的自相矛盾。
const NIGHT_START = 19;
const NIGHT_END = 6;

function normHour(hour) {
  const n = Math.floor(Number(hour));
  if (!isFinite(n)) return new Date().getHours();
  return ((n % 24) + 24) % 24;
}

function partAt(hour) {
  const h = normHour(hour);
  for (let i = 0; i < DAYPARTS.length; i++) {
    const p = DAYPARTS[i];
    // 跨零点那一档（23 → 5）不能直接用大小比较
    const hit = p.from < p.to ? h >= p.from && h < p.to : h >= p.from || h < p.to;
    if (hit) return p;
  }
  return DAYPARTS[1];
}

function isNight(hour) {
  const h = normHour(hour);
  return h >= NIGHT_START || h < NIGHT_END;
}

function sceneAt(hour) {
  return partAt(hour).scene;
}

// 只排一次定时器，精确落到下一个分档时刻，不轮询。
// 返回毫秒时间戳；跨零点会自己滚到第二天第一档。
function nextBoundary(now) {
  const t = Number(now) || Date.now();
  const d = new Date(t);
  const h = d.getHours();
  const starts = DAYPARTS.map((p) => p.from).sort((a, b) => a - b);
  let later = -1;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > h) {
      later = starts[i];
      break;
    }
  }
  const target = new Date(t);
  target.setMinutes(0, 0, 0);
  if (later < 0) {
    target.setDate(target.getDate() + 1);
    target.setHours(starts[0]);
  } else {
    target.setHours(later);
  }
  return target.getTime();
}

// 一个页面只需要取一次快照，别在同一个渲染周期里反复 new Date()
function snapshot(now) {
  const t = Number(now) || Date.now();
  const h = new Date(t).getHours();
  const part = partAt(h);
  return {
    hour: h,
    partId: part.id,
    scene: part.scene,
    isNight: isNight(h)
  };
}

module.exports = {
  DAYPARTS,
  NIGHT_START,
  NIGHT_END,
  partAt,
  isNight,
  sceneAt,
  nextBoundary,
  snapshot
};
