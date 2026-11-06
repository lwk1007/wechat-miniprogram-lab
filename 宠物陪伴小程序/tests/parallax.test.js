// 倾斜视差断言
//
// 这块要单独测，因为输入是「传感器原始角度」，它有三个容易出错的特性：
//   1. 一进页面并不为 0（手机握在手里 beta 大概 40–50°，横放时 gamma 也不是 0）
//   2. 原始数据抖得厉害，不滤波会像抖筛子
//   3. 层与层的位移必须严格递增，否则「前」和「后」读不出来，立体感直接失效
// 这三个都是纯数值问题，不测就只能靠肉眼在真机上猜。

const path = require('path');
const ROOT = path.join(__dirname, '..');
const px = require(path.join(ROOT, 'miniprogram/utils/parallax'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('\n[1] 倾斜角归一化');
const c = px.tiltUnit(0, 0, 0);
ok('正中 → (0, 0)', c.ux === 0 && c.uy === 0);
ok('右倾 15° → 0.5', Math.abs(px.tiltUnit(15, 0, 0).ux - 0.5) < 1e-9);
ok('左倾 -15° → -0.5', Math.abs(px.tiltUnit(-15, 0, 0).ux + 0.5) < 1e-9);
ok('超出 30° 被夹到 1', px.tiltUnit(80, 0, 0).ux === 1);
ok('负方向也被夹到 -1', px.tiltUnit(-80, 0, 0).ux === -1);
ok('NaN → 0，不产生 NaN 位移', px.tiltUnit(NaN, NaN, NaN).ux === 0);
ok('undefined → 0', px.tiltUnit(undefined, undefined, undefined).uy === 0);

console.log('\n[2] 握持基准（calibrate）');
// 手机拿在手里 beta ≈ 45°，不减基准的话一进页面整体偏出去 1.5 个满幅
const tilted = px.tiltUnit(0, 45, { x: 0, y: 45 });
ok('基准同姿态 → 位移为 0', tilted.ux === 0 && tilted.uy === 0);
ok('基准之上再倾 15° → 0.5', Math.abs(px.tiltUnit(0, 60, { x: 0, y: 45 }).uy - 0.5) < 1e-9);
ok('基准之下 15° → -0.5', Math.abs(px.tiltUnit(0, 30, { x: 0, y: 45 }).uy + 0.5) < 1e-9);
// 横着拿手机：gamma 本身就是 ±40 左右，只校 beta 会让整个画面一直偏在一边
ok('横放时 gamma 也参与校准', px.tiltUnit(40, 45, { x: 40, y: 45 }).ux === 0);
ok('base 传数字时只校 y（兼容旧调用）', px.tiltUnit(40, 45, 45).uy === 0 && px.tiltUnit(40, 45, 45).ux !== 0);

console.log('\n[3] 基准采样');
const b1 = px.baseline([{ x: 2, y: 40 }, { x: 4, y: 50 }]);
ok('两帧取均值', b1.x === 3 && b1.y === 45, JSON.stringify(b1));
ok('空数组 → 0', px.baseline([]).x === 0 && px.baseline([]).y === 0);
ok('undefined → 0', px.baseline(undefined).y === 0);
const b2 = px.baseline([{ x: 1, y: 40 }, { x: NaN, y: NaN }, { x: 3, y: 60 }]);
ok('坏样本被跳过而不是污染均值', b2.x === 2 && b2.y === 50, JSON.stringify(b2));

console.log('\n[4] 三层位移');
const strong = px.offsets({ ux: 1, uy: 0 }, px.PRESETS.card, 20);
ok('向右满倾时 y 为 0', strong.back.y === 0 && strong.mid.y === 0 && strong.front.y === 0);
ok('主体位移 = 强度', Math.abs(strong.mid.x - 20) < 1e-9, strong.mid.x);
ok('背景位移 < 主体', Math.abs(strong.back.x) < Math.abs(strong.mid.x));
ok('前景位移 > 主体', Math.abs(strong.front.x) > Math.abs(strong.mid.x));
// 这条是整个效果的命门：三层位移必须严格递增，否则读不出前后
ok('三层严格递增 back < mid < front',
  Math.abs(strong.back.x) < Math.abs(strong.mid.x) && Math.abs(strong.mid.x) < Math.abs(strong.front.x));
ok('方向一致（都往同一侧）', strong.back.x > 0 && strong.mid.x > 0 && strong.front.x > 0);

const up = px.offsets({ ux: 0, uy: -1 }, px.PRESETS.card, 20);
ok('向上倾时 x 为 0', up.mid.x === 0);
ok('向上倾位移为负', up.mid.y < 0);

const off0 = px.offsets({ ux: 0, uy: 0 }, px.PRESETS.card, 20);
ok('不倾斜 → 三层都归零', off0.back.x === 0 && off0.mid.x === 0 && off0.front.x === 0);

ok('强度 0 → 全零', px.offsets({ ux: 1, uy: 1 }, px.PRESETS.card, 0).mid.x === 0);
ok('强度变大位移等比放大', Math.abs(px.offsets({ ux: 1, uy: 0 }, px.PRESETS.card, 40).mid.x - 40) < 1e-9);
ok('缺参数不炸', px.offsets().mid.x === 0 && px.offsets(null, null, null).front.y === 0);
ok('NaN 倾斜不产生 NaN 位移', px.offsets({ ux: NaN, uy: NaN }, px.PRESETS.card, 20).mid.x === 0);

console.log('\n[5] 两套预设');
const cardKeys = Object.keys(px.PRESETS.card);
const cutKeys = Object.keys(px.PRESETS.cutout);
ok('两套预设字段一致', cardKeys.length === cutKeys.length && cardKeys.every((k) => cutKeys.indexOf(k) >= 0));
ok('card 系数递增', px.PRESETS.card.back < px.PRESETS.card.mid && px.PRESETS.card.mid < px.PRESETS.card.front);
ok('cutout 位移差更大（抠图能承担更大浮动）',
  px.PRESETS.cutout.front - px.PRESETS.cutout.mid > px.PRESETS.card.front - px.PRESETS.card.mid);
ok('cutout 背景更虚', px.PRESETS.cutout.blur > px.PRESETS.card.blur);

console.log('\n[6] 低通滤波');
ok('alpha=1 直接到目标', px.smooth(0, 10, 1) === 10);
ok('alpha=0 完全不动', px.smooth(3, 10, 0) === 3);
ok('中间值只走一部分', px.smooth(0, 10, 0.5) === 5);
ok('不会过冲', px.smooth(9.9, 10, 0.5) <= 10);
// 关键性质：单调逼近。有振荡的话画面会「弹」一下，比不滤波还难看
let v = 0;
let monotonic = true;
for (let i = 0; i < 30; i++) {
  const next = px.smooth(v, 10, 0.22);
  if (next < v || next > 10) monotonic = false;
  v = next;
}
ok('30 帧内单调逼近并收敛', monotonic && Math.abs(v - 10) < 0.01, v);
ok('NaN 输入被吞掉', px.smooth(NaN, 10, 0.5) === 5);
ok('alpha 越界被夹', px.smooth(0, 10, 5) === 10 && px.smooth(0, 10, -1) === 0);

const su = px.smoothUnit({ ux: 0, uy: 0 }, { ux: 1, uy: -1 }, 0.5);
ok('两轴各自滤波', su.ux === 0.5 && su.uy === -0.5);
ok('空当前值从 0 起算', px.smoothUnit(null, { ux: 1, uy: 0 }, 0.5).ux === 0.5);

console.log('\n[7] 是否值得 setData');
const base = { back: { x: 1, y: 0 }, mid: { x: 5, y: 0 }, front: { x: 9, y: 0 } };
ok('首次（没有上一帧）必须推', px.changed(null, base) === true);
ok('完全相同不推', px.changed(base, base) === false);
ok('0.2px 变化不推（肉眼看不出）',
  px.changed(base, { back: { x: 1.2, y: 0 }, mid: { x: 5.2, y: 0 }, front: { x: 9.2, y: 0 } }) === false);
ok('1px 变化要推',
  px.changed(base, { back: { x: 1, y: 0 }, mid: { x: 6, y: 0 }, front: { x: 9, y: 0 } }) === true);
ok('只有背景动也要推',
  px.changed(base, { back: { x: 4, y: 0 }, mid: { x: 5, y: 0 }, front: { x: 9, y: 0 } }) === true);

console.log('\n[8] clamp');
ok('下界', px.clamp(-5, 0, 1) === 0);
ok('上界', px.clamp(5, 0, 1) === 1);
ok('区间内原样返回', px.clamp(0.5, 0, 1) === 0.5);

console.log('\n' + (fail === 0 ? `全部通过 ${pass} 项` : `通过 ${pass} · 失败 ${fail}`));
process.exit(fail ? 1 : 0);
