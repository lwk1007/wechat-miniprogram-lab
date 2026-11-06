// 去白底 —— 「照片立体」里 cutout 模式的本地实现
//
// 原本 cutout 要等分割接口，但宠物照片里有一大类根本不用模型：
// 手绘稿、白墙前拍的、剪贴风格、表情包，背景就是一片白纸。
// 这类图用「从四边往内泛洪，只吃掉和边框连着的近白色」就能干净抠出来，
// 一次几毫秒，不上传、不花钱、不涉及算法备案。
//
// 关键在于「只吃连通的」：主体内部的白色（白猫的胸口、白 T 恤、眼白）
// 和边框不连通，所以要留着。反过来，任何"把白色全删掉"的做法都会在主体上打洞。
//
// 纯函数，输入 Uint8ClampedArray，不碰 wx API，测试不用打桩。

// 判定「纸白」：够亮 + 不够艳（白纸可能偏暖，所以给 18 的色差余量）
const TONE = { lum: 226, chroma: 18 };

// 贴着主体的那圈浅灰（白纸的阴影、扫描噪点）不算白，但也不该实心，
// 否则抠完主体边缘挂一圈毛边
const SOFT_LUM = 208;
const SOFT_ALPHA = 96;

// 边框上白色占比低于这个值，就认为不是白底图，直接不动
const MIN_BORDER_RATIO = 0.45;

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function isWhiteish(r, g, b, tone) {
  const t = tone || TONE;
  const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
  return min >= t.lum && max - min <= t.chroma;
}

// 四边一圈里有多少是白色。用它判断「这张到底是不是白底」，
// 不是白底就别硬抠 —— 硬抠会把照片背景打出一堆洞。
function borderWhiteRatio(rgba, w, h, tone) {
  if (!rgba || !w || !h) return 0;
  let white = 0;
  let total = 0;
  const test = (i) => {
    const p = i * 4;
    total++;
    // 已经是透明的像素按背景算（重复处理时结果应该一样）
    if (rgba[p + 3] < 8) { white++; return; }
    if (isWhiteish(rgba[p], rgba[p + 1], rgba[p + 2], tone)) white++;
  };
  for (let x = 0; x < w; x++) {
    test(x);
    if (h > 1) test((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    test(y * w);
    if (w > 1) test(y * w + w - 1);
  }
  return total ? white / total : 0;
}

// 主体去掉白底之后的 alpha 通道。
// 返回 applied=false 时 alpha 全是 255，调用方按「没处理」对待即可。
function removeWhite(rgba, w, h, opts) {
  const o = opts || {};
  const tone = Object.assign({}, TONE, o.tone);
  const total = w * h;
  const alpha = new Uint8ClampedArray(total);
  alpha.fill(255);
  if (!rgba || !w || !h) {
    return { alpha, removed: 0, total: 0, borderRatio: 0, applied: false };
  }

  const borderRatio = borderWhiteRatio(rgba, w, h, tone);
  if (borderRatio < num(o.minBorderRatio, MIN_BORDER_RATIO)) {
    return { alpha, removed: 0, total, borderRatio, applied: false };
  }

  // 泛洪：只从四边起步，所以主体内部的白永远到不了
  const bg = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const seed = (i) => {
    if (bg[i]) return;
    const p = i * 4;
    if (rgba[p + 3] < 8 || isWhiteish(rgba[p], rgba[p + 1], rgba[p + 2], tone)) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    if (h > 1) seed((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    seed(y * w);
    if (w > 1) seed(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }

  let removed = 0;
  for (let i = 0; i < total; i++) {
    if (bg[i]) { alpha[i] = 0; removed++; }
  }

  // 主体外侧那圈浅灰给半透明：不留白边，也不至于把线稿啃掉一截
  const softLum = num(o.softLum, SOFT_LUM);
  const softAlpha = num(o.softAlpha, SOFT_ALPHA);
  for (let i = 0; i < total; i++) {
    if (bg[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    const nearBg = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1])
      || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
    if (!nearBg) continue;
    const p = i * 4;
    const lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    if (lum >= softLum) alpha[i] = softAlpha;
  }

  return { alpha, removed, total, borderRatio, applied: true };
}

// 把算好的 alpha 写回 ImageData 的 A 通道（putImageData 要用同一份数据）
function applyAlpha(rgba, alpha) {
  if (!rgba || !alpha) return rgba;
  const n = Math.min(alpha.length, rgba.length / 4);
  for (let i = 0; i < n; i++) rgba[i * 4 + 3] = alpha[i];
  return rgba;
}

// 抠掉的面积占比。太低说明不是白底，太高说明整张都被吃掉了（纯白图）
function removedRatio(res) {
  if (!res || !res.total) return 0;
  return res.removed / res.total;
}

// ---------- 线稿识别 ----------
//
// 手绘稿是另一类：黑线画在白纸上，「身体」本身就是白纸。
// 对它用去白底，泛洪会顺着线条缺口钻进去把身体也吃掉，
// 结果只剩一圈描边 —— 看起来像黑色剪影，实际是毛边。
//
// 这类图正确的处理是「只留线条」：白色全透明，线条保留原色。
// 深色场景再靠 filter: invert(1) 翻成亮线，一张图两边都能用。
//
// 判据：白纸占比极高 + 几乎没有颜色。实心主体（照片、色块插画）
// 白色占比上不去，不会误判。

function whiteRatio(rgba, w, h, tone) {
  if (!rgba || !w || !h) return 0;
  let white = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (rgba[p + 3] < 8 || isWhiteish(rgba[p], rgba[p + 1], rgba[p + 2], tone)) white++;
  }
  return white / (w * h);
}

function inkProfile(rgba, w, h, tone) {
  const total = (w || 0) * (h || 0);
  if (!rgba || !total) return { whiteRatio: 0, avgChroma: 0, darkRatio: 0 };
  let white = 0;
  let dark = 0;
  let inkChroma = 0;
  let ink = 0;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    if (rgba[p + 3] < 8 || isWhiteish(r, g, b, tone)) { white++; continue; }
    ink++;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (lum < 120) dark++;
    inkChroma += max - min;
  }
  return {
    whiteRatio: white / total,
    // 颜色只看「墨」那部分：拿全图平均的话，一小块彩色被大片白纸稀释，
    // 会被误判成黑白线稿
    avgChroma: ink ? inkChroma / ink : 0,
    darkRatio: dark / total
  };
}

const LINEART_WHITE = 0.72;   // 白纸至少占这么多
const LINEART_CHROMA = 30;    // 且几乎没颜色（彩色手绘不当线稿）
const LINEART_DARK = 0.35;    // 且深色只占一小部分（实心主体会超过这个）

function classify(rgba, w, h, opts) {
  const o = opts || {};
  const tone = Object.assign({}, TONE, o.tone);
  const border = borderWhiteRatio(rgba, w, h, tone);
  if (border < num(o.minBorderRatio, MIN_BORDER_RATIO)) return 'none';
  const prof = inkProfile(rgba, w, h, tone);
  if (prof.whiteRatio >= num(o.lineartWhite, LINEART_WHITE)
    && prof.avgChroma <= num(o.lineartChroma, LINEART_CHROMA)
    && prof.darkRatio <= num(o.lineartDark, LINEART_DARK)) {
    return 'lineart';
  }
  return 'cutout';
}

// 线稿专用：不泛洪，直接按「有多不像纸」定透明度。
//
// 为什么不能沿用 removeWhite：笔画的方框一旦闭合，泛洪就进不去，
// 身体内部的白纸会整片留在原地，出来的是一块白填充加黑边 —— 在深色背景上更难看。
// 线稿的白纸（不管是外面那圈还是身体里那块）都要透明，所以这里不做连通性判断。
function lineArtAlpha(rgba, w, h, opts) {
  const o = opts || {};
  const tone = Object.assign({}, TONE, o.tone);
  const floor = num(o.floorLum, 90);   // 到这个亮度就是纯不透明
  const total = (w || 0) * (h || 0);
  const alpha = new Uint8ClampedArray(total);
  if (!rgba || !total) return alpha;
  const span = Math.max(1, tone.lum - floor);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    if (rgba[p + 3] < 8) { alpha[i] = 0; continue; }
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    if (isWhiteish(r, g, b, tone)) { alpha[i] = 0; continue; }
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // 纸上没有"半透明的墨"这种说法：越淡越像铅笔灰，按亮度线性给透明度
    const a = Math.round(((tone.lum - lum) / span) * 255);
    alpha[i] = a < 0 ? 0 : a > 255 ? 255 : a;
  }
  return alpha;
}

module.exports = {
  TONE,
  SOFT_LUM,
  SOFT_ALPHA,
  MIN_BORDER_RATIO,
  LINEART_WHITE,
  LINEART_CHROMA,
  LINEART_DARK,
  isWhiteish,
  borderWhiteRatio,
  whiteRatio,
  inkProfile,
  classify,
  removeWhite,
  lineArtAlpha,
  applyAlpha,
  removedRatio
};
