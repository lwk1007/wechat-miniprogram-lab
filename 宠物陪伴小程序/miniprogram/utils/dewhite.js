// 去白底 —— 只清「和画面四边连通的纸白」，被轮廓围住的白一律保留。
//
// 为什么必须按连通性、而不是按颜色来分：
// 白底配白色主体时（手绘稿的身体、白猫、白瓷杯），主体和背景是同一种颜色，
// 颜色层面根本不存在可分的信息。真正能把它们分开的是拓扑 ——
// 背景那层纸连着照片边缘，主体内部的纸被墨线圈住了、够不到边缘。
// 所以从四边往内泛洪，只吃够得着的白，被围住的白自然活下来。
// 任何「把白色删掉」的做法（按亮度定透明度、按阈值二值化）都会在主体上打洞。
//
// 手绘线条有断口，泛洪会顺着断口钻进去把身体也吃掉。对策两步：
//   1. 封口：把「墨」这层墙向外膨胀 seal 个像素，把窄断口糊住再泛洪；
//   2. 还白：泛洪结束后，沿纸白像素往回走最多 seal 步，把封口时多挡掉的那圈白还回去。
// 膨胀多挡出的白必须还，否则主体外面挂一圈白毛边。
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

// 封口半径（像素）。手绘断口通常是 1~3px，2 够用；
// 再大就会把「手指缝」这种正常空隙也糊上。
const SEAL_RADIUS = 2;

// 边缘细条清理。拍/扫的纸边上常带一道 1~3px 的暗边（纸的投影、扫描仪黑边、
// 拍进画面的桌沿）。它不是纸白，泛洪当它是「墨」而留下，抠完就在主体上方浮一条
// 笔直的暗线 —— 这条线是暗的、比背景更暗，所以不是羽化不足，也不是白边残留。
//
// 判据只有一条：细、横贯整幅、紧接着就是空的。真正的画面内容不会「占满一整行、
// 下一行立刻什么都没有」。主体若贴着这条边，下一行还是主体，就不会被误删。
const EDGE_BAND_RATIO = 0.008;  // 最多从每条边往内剥这么厚（相对短边）
const EDGE_BAND_MAX = 3;        // 上限压到 3px：照片边几乎都是 1~3px，再厚就该人工裁了
const EDGE_COVER = 0.5;         // 这一行/列有一半可见 → 可疑
const EDGE_GAP = 0.35;          // 往里紧接的一行必须几乎全空，才敢下刀
const EDGE_VISIBLE = 40;        // 算「可见」的 alpha 下限（含半透明的软边）

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

// 把一张 0/1 掩膜按四邻域膨胀 r 圈。
// 用四邻域而不是方框核，是为了和 growBg 的度量一致 —— 膨胀挡住的那圈白，
// 事后能一模一样地还回去，背景边界不会因为核形状差一圈而对不齐。
function dilate(mask, w, h, r) {
  let cur = mask;
  const total = w * h;
  for (let s = 0; s < r; s++) {
    const next = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (cur[i]) { next[i] = 1; continue; }
      const x = i % w;
      const y = (i - x) / w;
      if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1])
        || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1;
    }
    cur = next;
  }
  return cur;
}

// 把背景往回扩 steps 步，只走纸白（不穿墙）。
// 作用是把膨胀封口时多挡掉的那圈白还给背景，否则主体边上会留一圈白毛。
// 只走固定步数，所以即使断口被糊住了，最多也只从断口渗进去 steps 个像素。
function growBg(bg, wall, w, h, steps) {
  let frontier = [];
  for (let i = 0; i < bg.length; i++) {
    if (bg[i]) frontier.push(i);
  }
  for (let s = 0; s < steps && frontier.length; s++) {
    const next = [];
    for (let n = 0; n < frontier.length; n++) {
      const i = frontier[n];
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && !bg[i - 1] && !wall[i - 1]) { bg[i - 1] = 1; next.push(i - 1); }
      if (x < w - 1 && !bg[i + 1] && !wall[i + 1]) { bg[i + 1] = 1; next.push(i + 1); }
      if (y > 0 && !bg[i - w] && !wall[i - w]) { bg[i - w] = 1; next.push(i - w); }
      if (y < h - 1 && !bg[i + w] && !wall[i + w]) { bg[i + w] = 1; next.push(i + w); }
    }
    frontier = next;
  }
}

// 剥掉贴着画面四边的细暗条。返回清掉的线条数，0 表示四边都正常。
//
// 只在最外那圈（默认 1.5% 短边，最多 8px）里找，找到的每一条都必须满足：
//   1. 这一行/列至少一半是可见的；
//   2. 连续几行都这样（把 2~3px 厚的暗边一次剥干净）；
//   3. 再往里紧接的一行几乎全空。
// 第 3 条是安全阀：主体贴着边时条件 1、2 成立，但第 3 条不成立，于是不动。
function stripEdgeLines(alpha, w, h, opts) {
  if (!alpha || !w || !h) return 0;
  const o = opts || {};
  const visible = num(o.edgeVisible, EDGE_VISIBLE);
  const band = Math.max(2, Math.min(
    Math.round(Math.min(w, h) * num(o.bandRatio, EDGE_BAND_RATIO)),
    num(o.bandMax, EDGE_BAND_MAX)
  ));
  const COVER = num(o.edgeCover, EDGE_COVER);
  const GAP = num(o.edgeGap, EDGE_GAP);

  const lineLen = (dir) => (dir < 2 ? w : h);
  // dir: 0 上 / 1 下 / 2 左 / 3 右；i 是从该边往内的第几行（列），k 是沿线第几个像素
  const idxOf = (dir, i, k) => {
    if (dir === 0) return i * w + k;
    if (dir === 1) return (h - 1 - i) * w + k;
    if (dir === 2) return k * w + i;
    return k * w + (w - 1 - i);
  };
  const cover = (dir, i) => {
    // 越界当「满」，免得把「画面外」误判成空
    if (i >= (dir < 2 ? h : w)) return 1;
    const n = lineLen(dir);
    let c = 0;
    for (let k = 0; k < n; k++) if (alpha[idxOf(dir, i, k)] >= visible) c++;
    return c / n;
  };

  let cleared = 0;
  for (let dir = 0; dir < 4; dir++) {
    let i = 0;
    while (i < band && cover(dir, i) < COVER) i++;
    if (i >= band) continue;
    let j = i;
    while (j + 1 < band && cover(dir, j + 1) >= COVER) j++;
    if (cover(dir, j + 1) > GAP) continue;
    const n = lineLen(dir);
    for (let r = i; r <= j; r++) {
      for (let k = 0; k < n; k++) {
        const idx = idxOf(dir, r, k);
        if (alpha[idx]) alpha[idx] = 0;
      }
    }
    cleared += j - i + 1;
  }
  return cleared;
}

// 主体去掉白底之后的 alpha 通道。
// 返回 applied=false 时 alpha 全是 255，调用方按「没处理」对待即可。
//
// kept = 保留下来的纸白像素数。它回答的是「主体的填充还在不在」：
// 轮廓闭合时这个数接近身体面积；线条没围住东西时它接近 0。
function removeWhite(rgba, w, h, opts) {
  const o = opts || {};
  const tone = Object.assign({}, TONE, o.tone);
  const total = w * h;
  const alpha = new Uint8ClampedArray(total);
  alpha.fill(255);
  if (!rgba || !w || !h) {
    return { alpha, removed: 0, kept: 0, total: 0, borderRatio: 0, applied: false };
  }

  const borderRatio = borderWhiteRatio(rgba, w, h, tone);
  if (borderRatio < num(o.minBorderRatio, MIN_BORDER_RATIO)) {
    return { alpha, removed: 0, kept: 0, total, borderRatio, applied: false };
  }

  // 墙 = 不是纸白的像素（墨线、深色块）。透明像素不挡路，重复处理结果才稳定
  const wall = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    if (rgba[p + 3] < 8) continue;
    if (!isWhiteish(rgba[p], rgba[p + 1], rgba[p + 2], tone)) wall[i] = 1;
  }

  const seal = Math.max(0, Math.round(num(o.seal, SEAL_RADIUS)));
  const blocked = seal > 0 ? dilate(wall, w, h, seal) : wall;

  // 泛洪：只从四边起步。主体内部的白被墨线围着，永远到不了
  const bg = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const seed = (i) => {
    if (bg[i] || blocked[i]) return;
    bg[i] = 1;
    queue[tail++] = i;
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

  if (seal > 0) growBg(bg, wall, w, h, seal);

  let removed = 0;
  let kept = 0;
  for (let i = 0; i < total; i++) {
    if (bg[i]) { alpha[i] = 0; removed++; }
    else if (!wall[i]) kept++;
  }

  // 主体外侧那圈浅灰给半透明：不留白边，也不至于把线条啃掉一截
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

  // 最后剥掉照片自带的那道边。放在软边之后，因为它专门吃「半明半暗的细条」
  const edge = o.edgeClean === false ? 0 : stripEdgeLines(alpha, w, h, o);

  return { alpha, removed, kept, total, borderRatio, applied: true, edge };
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

// 保留下来的纸白占比。轮廓闭合 → 接近身体面积；线条没围住东西 → 接近 0
function keptRatio(res) {
  if (!res || !res.total) return 0;
  return res.kept / res.total;
}

// ---------- 画像 ----------
//
// 这里只用来回答一个外观问题：「这张是不是白纸 + 墨线」。
// 它不再参与「怎么去底」的决策 —— 去底一律走连通性，
// 所以判错最多是夜间反色反错了，不会把主体挖空。

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
    // 颜色只看「墨」那部分：一小块彩色被大片白纸稀释后，
    // 用全图平均会被误判成黑白
    avgChroma: ink ? inkChroma / ink : 0,
    darkRatio: dark / total
  };
}

const LINEART_WHITE = 0.72;   // 白纸至少占这么多
const LINEART_CHROMA = 30;    // 且几乎没颜色（彩色手绘不当墨线）
const LINEART_DARK = 0.35;    // 且深色只占一小部分（实心黑色主体会超过这个）

module.exports = {
  TONE,
  SOFT_LUM,
  SOFT_ALPHA,
  MIN_BORDER_RATIO,
  SEAL_RADIUS,
  EDGE_BAND_RATIO,
  EDGE_COVER,
  EDGE_GAP,
  LINEART_WHITE,
  LINEART_CHROMA,
  LINEART_DARK,
  isWhiteish,
  borderWhiteRatio,
  whiteRatio,
  inkProfile,
  removeWhite,
  stripEdgeLines,
  applyAlpha,
  removedRatio,
  keptRatio
};
