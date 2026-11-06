// 「一起生活的第 N 天」断言
//
// 这块要单独测，因为它把三个字段拼成了一个数字，而这三个字段的边界都很滑：
//   sinceDate 是 picker 给的 'YYYY-MM-DD' 字符串（不是时间戳）
//   createdAt 可能缺失
//   互动记录是按本地日期分桶的 map，跨月要能往回数
// 天数算错一天，用户第一眼就看出来，而且没法解释。

const path = require('path');
const ROOT = path.join(__dirname, '..');
const together = require(path.join(ROOT, 'miniprogram/utils/together'));
const moments = require(path.join(ROOT, 'miniprogram/utils/moments'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n[1] 日期串解析');
const d1 = new Date(together.parseYmd('2026-08-14'));
ok('2026-08-14 解出 8 月 14 日', d1.getFullYear() === 2026 && d1.getMonth() === 7 && d1.getDate() === 14,
  d1.toDateString());
ok('个位数月份也认', together.parseYmd('2026-8-4') > 0);
ok('前后空格容错', together.parseYmd('  2026-08-14  ') > 0);
ok('不存在的 2 月 30 日 → 0', together.parseYmd('2026-02-30') === 0);
ok('13 月 → 0', together.parseYmd('2026-13-01') === 0);
ok('0 日 → 0', together.parseYmd('2026-08-00') === 0);
ok('斜杠格式不认 → 0', together.parseYmd('2026/08/14') === 0);
ok('空串 → 0', together.parseYmd('') === 0);
ok('null → 0', together.parseYmd(null) === 0);
ok('undefined → 0', together.parseYmd(undefined) === 0);
ok('纯文字 → 0', together.parseYmd('abc') === 0);

console.log('\n[2] 第 N 天：见面当天算第 1 天');
const NOW = new Date(2026, 10, 6, 15, 30, 0).getTime(); // 2026-11-06 15:30 本地时间
ok('同一天 → 第 1 天', together.daysTogether({ sinceDate: '2026-11-06' }, NOW) === 1,
  together.daysTogether({ sinceDate: '2026-11-06' }, NOW));
ok('同一天不同时刻仍是第 1 天',
  together.daysTogether({ sinceDate: '2026-11-06' }, new Date(2026, 10, 6, 0, 5).getTime()) === 1);
ok('昨天 → 第 2 天', together.daysTogether({ sinceDate: '2026-11-05' }, NOW) === 2);
ok('8 月 14 日起算 → 第 85 天', together.daysTogether({ sinceDate: '2026-08-14' }, NOW) === 85,
  together.daysTogether({ sinceDate: '2026-08-14' }, NOW));
ok('跨一年（2024 是闰年）→ 367 天',
  together.daysTogether({ createdAt: new Date(2024, 0, 1).getTime() }, new Date(2025, 0, 1).getTime()) === 367,
  together.daysTogether({ createdAt: new Date(2024, 0, 1).getTime() }, new Date(2025, 0, 1).getTime()));
ok('跨月边界：10-31 → 11-01 是 2 天',
  together.daysTogether({ sinceDate: '2026-10-31' }, new Date(2026, 10, 1, 9, 0).getTime()) === 2);

console.log('\n[3] 起算日优先级与兜底');
const created = new Date(2026, 10, 1, 8, 0).getTime();
ok('有 sinceDate 就用它', together.startAt({ sinceDate: '2026-09-01', createdAt: created }) === together.parseYmd('2026-09-01'));
ok('sinceDate 为空回落到 createdAt', together.startAt({ sinceDate: '', createdAt: created }) === created);
ok('sinceDate 非法也回落', together.startAt({ sinceDate: '不是日期', createdAt: created }) === created);
ok('两个都没有 → 0', together.startAt({}) === 0);
ok('没有任何宠物 → 0 天', together.daysTogether(null, NOW) === 0);
ok('起算日填成未来 → 兜回第 1 天，不给负数',
  together.daysTogether({ sinceDate: '2026-12-01' }, NOW) === 1,
  together.daysTogether({ sinceDate: '2026-12-01' }, NOW));

console.log('\n[4] 里程碑');
let m = together.milestoneOf(1);
ok('第 1 天：已达 1，下一个 7', m.reached === 1 && m.next === 7 && m.toNext === 6, JSON.stringify(m));
m = together.milestoneOf(7);
ok('第 7 天：已达 7，下一个 14', m.reached === 7 && m.next === 14);
m = together.milestoneOf(10);
ok('第 10 天：距 14 还有 4 天', m.toNext === 4);
ok('第 10 天的进度按 7→14 区间算，不是 10/14',
  Math.abs(m.progress - 3 / 7) < 1e-9, m.progress);
m = together.milestoneOf(365);
ok('第 365 天：已达 365，下一个 500', m.reached === 365 && m.next === 500);
m = together.milestoneOf(99999);
ok('超出最后一档：没有下一个，进度拉满', m.next === 0 && m.progress === 1);
m = together.milestoneOf(0);
ok('第 0 天（异常值）：未达成任何里程碑', m.reached === 0 && m.next === 1);

console.log('\n[5] 连续陪伴');
ok('日期键格式与足迹模块一致', moments.dayKey(new Date(2026, 10, 6)) === '2026-11-06');
const k = (y, mo, d) => moments.dayKey(new Date(y, mo - 1, d));
ok('今天+昨天+前天 → 3 天',
  together.streakOf({ [k(2026, 11, 6)]: 2, [k(2026, 11, 5)]: 1, [k(2026, 11, 4)]: 3 }, NOW) === 3);
ok('今天还没互动 → 从昨天数，不清零',
  together.streakOf({ [k(2026, 11, 5)]: 1, [k(2026, 11, 4)]: 1 }, NOW) === 2,
  together.streakOf({ [k(2026, 11, 5)]: 1, [k(2026, 11, 4)]: 1 }, NOW));
ok('中间断一天 → 只算到今天',
  together.streakOf({ [k(2026, 11, 6)]: 1, [k(2026, 11, 4)]: 1 }, NOW) === 1);
ok('跨月往回数：11-01 连到 10-30',
  together.streakOf({ [k(2026, 10, 31)]: 1, [k(2026, 10, 30)]: 1 }, new Date(2026, 10, 1, 10, 0).getTime()) === 2);
ok('空记录 → 0', together.streakOf({}, NOW) === 0);
ok('null → 0', together.streakOf(null, NOW) === 0);

console.log('\n[6] 落款日期');
ok('2026-08-14 → 2026年8月14日', together.fmtDate(together.parseYmd('2026-08-14')) === '2026年8月14日',
  together.fmtDate(together.parseYmd('2026-08-14')));
ok('0 → 空串', together.fmtDate(0) === '');

console.log('\n[7] summary 在没有本机存储时也不炸');
// node 环境下没有 wx，moments.summary() 内部会走 catch 返回空记录。
// 这一条防的是：弹层打开时读到空数据直接抛异常，用户点了日历什么也没有。
const s = together.summary({ sinceDate: '2026-11-01', createdAt: created }, NOW);
ok('返回对象而不是抛异常', s && typeof s === 'object');
ok('天数仍然算对（不依赖存储）', s.days === 6, s.days);
ok('互动数在无存储时为 0', s.total === 0 && s.activeDays === 0 && s.streak === 0);
ok('带上起算日文案', s.startText === '2026年11月1日', s.startText);
ok('带上里程碑', !!s.milestone && s.milestone.next === 7);

console.log('\n' + (fail === 0 ? '全部通过 ' + pass + ' 项' : '通过 ' + pass + ' 项，失败 ' + fail + ' 项'));
process.exit(fail ? 1 : 0);
