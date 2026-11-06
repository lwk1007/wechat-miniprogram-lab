// 时间分段断言：一天怎么切、此刻该去哪、天黑了没
//
// 单独测这块，是因为它现在是「唯一的时间来源」——陪伴页场景、桌面页夜色、
// 宠物作息都从这里取。边界错一格，三个地方一起错，而且错得很隐蔽：
// 之前 20:00 场景已经进了星空、宠物却还停在傍晚的开心档，就是两边各写一套边界。

const path = require('path');
const ROOT = path.join(__dirname, '..');
const timeline = require(path.join(ROOT, 'miniprogram/utils/timeline'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n[1] 五档边界');
const cases = [
  [0, 'latenight'], [3, 'latenight'], [4, 'latenight'],
  [5, 'dawn'], [8, 'dawn'],
  [9, 'day'], [16, 'day'],
  [17, 'dusk'], [19, 'dusk'],
  [20, 'evening'], [22, 'evening'],
  [23, 'latenight']
];
cases.forEach(([h, want]) => {
  const got = timeline.partAt(h).id;
  ok(h + ' 点 → ' + want, got === want, got);
});

console.log('\n[2] 每档默认去哪');
ok('清晨去窗台', timeline.sceneAt(6) === 'window');
ok('白天去草地', timeline.sceneAt(12) === 'grass');
ok('傍晚去海边', timeline.sceneAt(18) === 'seaside');
ok('入夜进星空', timeline.sceneAt(20) === 'night');
ok('深夜仍在星空', timeline.sceneAt(2) === 'night');

console.log('\n[3] 天黑与「该去哪」是两个维度');
ok('18:59 还不算夜', timeline.isNight(18) === false);
ok('19:00 入夜', timeline.isNight(19) === true);
ok('5:59 仍是夜', timeline.isNight(5) === true);
ok('6:00 天亮', timeline.isNight(6) === false);
ok('19 点天黑了，但默认还留在海边', timeline.isNight(19) === true && timeline.sceneAt(19) === 'seaside');

console.log('\n[4] 跨零点那一档');
ok('23 / 0 / 4 点同属深夜', [23, 0, 4].every((h) => timeline.partAt(h).id === 'latenight'));

console.log('\n[5] 非法输入不抛错，归一到合法档');
[NaN, undefined, null, -3, 29, 'abc', 12.7].forEach((bad) => {
  let p = null;
  try { p = timeline.partAt(bad); } catch (e) { p = null; }
  ok('partAt(' + String(bad) + ') 仍是有效档', !!p && !!p.id, p && p.id);
});
ok('29 点等价于 5 点', timeline.partAt(29).id === timeline.partAt(5).id);
ok('12.7 点等价于 12 点', timeline.partAt(12.7).id === timeline.partAt(12).id);

console.log('\n[6] 下一个分档时刻');
const at = (h, m) => new Date(2026, 10, 6, h, m, 0, 0).getTime();
ok('21:31 → 当天 23:00', new Date(timeline.nextBoundary(at(21, 31))).getHours() === 23);
ok('8:00 → 当天 9:00', new Date(timeline.nextBoundary(at(8, 0))).getHours() === 9);
ok('23:30 跨零点 → 次日 5:00', new Date(timeline.nextBoundary(at(23, 30))).getHours() === 5);
ok('跨零点时日期进到下一天', new Date(timeline.nextBoundary(at(23, 30))).getDate() === 7);
ok('边界一定晚于当前时刻', timeline.nextBoundary(at(21, 31)) > at(21, 31));

console.log('\n[7] 快照');
const snap = timeline.snapshot(at(21, 31));
ok('21:31 属于 evening', snap.partId === 'evening', snap.partId);
ok('21:31 该去星空', snap.scene === 'night', snap.scene);
ok('21:31 是夜里', snap.isNight === true);
ok('四个字段齐全', ['hour', 'partId', 'scene', 'isNight'].every((k) => snap[k] !== undefined));
ok('快照与单独调用结果一致',
  snap.partId === timeline.partAt(21).id && snap.isNight === timeline.isNight(21));

console.log('\n[8] 结构：无空档、无重叠、无死档');
const count = {};
for (let h = 0; h < 24; h++) {
  const id = timeline.partAt(h).id;
  count[id] = (count[id] || 0) + 1;
}
const total = Object.keys(count).reduce((a, k) => a + count[k], 0);
ok('24 小时全部有归属', total === 24, total);
ok('五档都被用到，没有死档', timeline.DAYPARTS.every((p) => count[p.id] > 0), JSON.stringify(count));
let switches = 0;
for (let h = 0; h < 24; h++) {
  if (timeline.partAt((h + 23) % 24).id !== timeline.partAt(h).id) switches++;
}
ok('一天恰好切 5 次档', switches === 5, switches);

console.log('\n────────────────────────────────────────────────');
console.log('  通过 ' + pass + ' · 失败 ' + fail);
if (fail > 0) process.exit(1);
