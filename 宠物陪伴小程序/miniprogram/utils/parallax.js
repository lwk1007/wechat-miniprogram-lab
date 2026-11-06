// 倾斜视差 —— #7「照片抠图立体」里「立体」的那一半
//
// 只有两步：把手机倾斜角归一化成 -1..1，再按各层景深系数换成像素位移。
// 位移方向一致、幅度不同，视觉上就读成前后有厚度。
//
// 全部是纯函数，不碰 wx API，测试不用打桩（和 rollActivity / recapPlan 一个风格）。
// 时间与随机都不参与，所以结果可复现。

// 倾斜到 30° 就算满幅。不做成 90°：手握着看手机本来就倾斜 30–50°，
// 按 90° 归一化的话轻微动作几乎没有位移，等于没做。
const MAX_UNIT_TILT = 30;

// 一阶低通系数。陀螺仪原始数据抖动明显，直接用会像在抖筛子。
// 0.22 ≈ 60ms 一次采样时，约 5 帧跟上，手感是「跟手但稳」。
const SMOOTH_ALPHA = 0.22;

// 景深系数：back < mid < front。
// card 是「没有抠图时」的三层：模糊背景 + 照片卡 + 高光。
// cutout 是「有透明前景」时：主体换成抠图，位移差可以拉大，浮起来更明显。
const PRESETS = {
  card: { back: 0.28, mid: 1, front: 1.75, blur: 18, scaleBack: 1.16 },
  cutout: { back: 0.22, mid: 1.05, front: 1.9, blur: 22, scaleBack: 1.2 }
};

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 倾斜角 → 单位向量。
// gamma 是左右倾（-90..90），beta 是前后倾（-180..180）。
//
// base 是「握持基准」，两个轴都要减。参考 parallax.js 的 calibrate-x / calibrate-y：
// 只校 y 不校 x 的话，手机横着放（gamma 就已经不是 0）一进页面所有层就整体偏到一边。
// 基准可以是数字（只校 y，兼容旧调用）也可以是 { x, y }。
function tiltUnit(gamma, beta, base) {
  const g = num(gamma, 0);
  const b = num(beta, 0);
  const baseX = num(base && base.x, 0);
  const baseY = typeof base === 'number' ? base : num(base && base.y, 0);
  return {
    ux: clamp((g - baseX) / MAX_UNIT_TILT, -1, 1),
    uy: clamp((b - baseY) / MAX_UNIT_TILT, -1, 1)
  };
}

// 单位向量 → 三层各自位移（px）。
// 取两位小数：亚像素位移在合成层上会让照片发虚，但又不能取整，
// 否则慢速倾斜时会一格一格地跳。
function offsets(u, cfg, strength) {
  const c = cfg || PRESETS.card;
  const s = num(strength, 18);
  const ux = num(u && u.ux, 0);
  const uy = num(u && u.uy, 0);
  const at = (k) => ({
    x: Math.round(ux * s * k * 100) / 100,
    y: Math.round(uy * s * k * 100) / 100
  });
  return {
    back: at(c.back),
    mid: at(c.mid),
    front: at(c.front)
  };
}

// 一阶低通：cur 追 target，alpha 越大追得越快
function smooth(cur, target, alpha) {
  const a = clamp(num(alpha, SMOOTH_ALPHA), 0, 1);
  const c = num(cur, 0);
  const t = num(target, 0);
  if (a >= 1) return t;
  return c + (t - c) * a;
}

function smoothUnit(cur, target, alpha) {
  return {
    ux: smooth(cur && cur.ux, target && target.ux, alpha),
    uy: smooth(cur && cur.uy, target && target.uy, alpha)
  };
}

// 位移有变化才值得 setData。0.3px 以下肉眼看不出，但每帧都发一条消息照样耗电。
function changed(a, b, eps) {
  const e = num(eps, 0.3);
  if (!a || !b) return true;
  return Math.abs(a.back.x - b.back.x) > e
    || Math.abs(a.back.y - b.back.y) > e
    || Math.abs(a.mid.x - b.mid.x) > e
    || Math.abs(a.mid.y - b.mid.y) > e
    || Math.abs(a.front.x - b.front.x) > e
    || Math.abs(a.front.y - b.front.y) > e;
}

// 握持基准：取前若干个样本的均值。
// 只用一帧会被开机瞬间的姿态带偏（parallax.js 的 calibrate 也是攒一帧就锁，
// 但它锁的是事件值，我们是采样均值，抗抖更好一点）。
function baseline(samples) {
  const zero = { x: 0, y: 0 };
  if (!samples || !samples.length) return zero;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s) continue;
    const x = num(s.x, NaN);
    const y = num(s.y, NaN);
    if (isFinite(x) && isFinite(y)) {
      sx += x;
      sy += y;
      n++;
    }
  }
  return n ? { x: sx / n, y: sy / n } : zero;
}

module.exports = {
  MAX_UNIT_TILT,
  SMOOTH_ALPHA,
  PRESETS,
  clamp,
  tiltUnit,
  offsets,
  smooth,
  smoothUnit,
  changed,
  baseline
};
