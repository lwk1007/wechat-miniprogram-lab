// 去白底断言
//
// 这块最容易错的地方不是"能不能去掉白"，而是"会不会把主体上的白也去掉"。
// 白猫的胸口、白 T 恤、眼白、线稿里留白的部分，都是和边框不连通的白色，
// 一旦被当成背景删掉，主体就成筛子了。所以测试里专门造了一个"黑框包着白点"的图。
//
// 另外两个性质也值得钉住：不是白底的图必须原样返回；已经透明的图重复处理结果不变。

const path = require('path');
const ROOT = path.join(__dirname, '..');
const dw = require(path.join(ROOT, 'miniprogram/utils/dewhite'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// 造一张图：默认全白
function makeCanvas(w, h, rgb) {
  const d = new Uint8ClampedArray(w * h * 4);
  const c = rgb || [255, 255, 255];
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }
  return d;
}
function fillRect(d, w, x0, y0, x1, y1, rgb, a) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * w + x) * 4;
      d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2];
      d[p + 3] = a === undefined ? 255 : a;
    }
  }
}
function alphaAt(d, w, x, y) {
  return d[(y * w + x) * 4 + 3];
}

const W = 40;
const H = 40;

console.log('\n[1] 判定白');
ok('纯白算白', dw.isWhiteish(255, 255, 255));
ok('偏暖的纸白也算白', dw.isWhiteish(250, 246, 238));
ok('浅灰不算白', !dw.isWhiteish(220, 220, 220));
ok('偏色的黄不算白', !dw.isWhiteish(255, 240, 180));
ok('深色不算白', !dw.isWhiteish(40, 40, 40));

console.log('\n[2] 边框白色占比');
const allWhite = makeCanvas(W, H);
ok('整张白 → 1', Math.abs(dw.borderWhiteRatio(allWhite, W, H) - 1) < 1e-6);
const midGray = makeCanvas(W, H, [128, 128, 128]);
ok('整张灰 → 0', dw.borderWhiteRatio(midGray, W, H) === 0);
const halfWhite = makeCanvas(W, H);
fillRect(halfWhite, W, 0, H / 2, W - 1, H - 1, [30, 30, 30]);
ok('下半深色时占比不满', dw.borderWhiteRatio(halfWhite, W, H) < 1);

console.log('\n[3] 白底 + 居中主体');
const d3 = makeCanvas(W, H);
fillRect(d3, W, 14, 14, 25, 25, [30, 30, 30]);
const r3 = dw.removeWhite(d3, W, H);
ok('识别为白底', r3.applied === true);
ok('主体中心保留', r3.alpha[20 * W + 20] === 255, r3.alpha[20 * W + 20]);
ok('四角被吃掉', r3.alpha[0] === 0 && r3.alpha[W * H - 1] === 0);
ok('吃掉的数量 = 总数 - 主体面积', r3.removed === W * H - 12 * 12, r3.removed);
ok('占比在 0 到 1 之间', dw.removedRatio(r3) > 0.8 && dw.removedRatio(r3) < 1);

console.log('\n[4] 主体内部的白必须留着（这是最关键的一条）');
const d4 = makeCanvas(W, H);
fillRect(d4, W, 10, 10, 29, 29, [20, 20, 20]);   // 黑色主体
fillRect(d4, W, 17, 17, 22, 22, [255, 255, 255]); // 主体内部一块纯白（白猫胸口那种）
const r4 = dw.removeWhite(d4, W, H);
ok('内部白点没有被泛洪吃掉', r4.alpha[19 * W + 19] === 255, r4.alpha[19 * W + 19]);
ok('外部白底仍然被吃掉', r4.alpha[2 * W + 2] === 0);
ok('主体黑边保留', r4.alpha[11 * W + 11] === 255);

console.log('\n[5] 不该动的图就别动');
const photo = makeCanvas(W, H, [90, 120, 160]);
const r5 = dw.removeWhite(photo, W, H);
ok('四边不是白 → applied=false', r5.applied === false, r5.borderRatio);
ok('alpha 全是 255', r5.alpha.every((v) => v === 255));
ok('removed 为 0', r5.removed === 0);

console.log('\n[6] 已经透明的图重复处理不变');
const d6 = makeCanvas(W, H, [255, 255, 255]);
fillRect(d6, W, 14, 14, 25, 25, [30, 30, 30]);
for (let i = 0; i < W * H; i++) { /* 先手动清成透明背景 */ }
fillRect(d6, W, 0, 0, W - 1, H - 1, [255, 255, 255], 0);
fillRect(d6, W, 14, 14, 25, 25, [30, 30, 30], 255);
const r6 = dw.removeWhite(d6, W, H);
ok('透明像素算作背景', r6.applied === true, r6.borderRatio);
ok('主体依旧保留', r6.alpha[20 * W + 20] === 255);

console.log('\n[7] 边缘浅灰给半透明');
const d7 = makeCanvas(W, H);
fillRect(d7, W, 14, 14, 25, 25, [220, 220, 220]); // 浅灰主体，比白深但不算白
const r7 = dw.removeWhite(d7, W, H);
ok('灰块中心不透明', r7.alpha[20 * W + 20] === 255, r7.alpha[20 * W + 20]);
ok('灰块最外圈半透明', r7.alpha[14 * W + 20] === dw.SOFT_ALPHA, r7.alpha[14 * W + 20]);

console.log('\n[8] 全白图不会崩');
const r8 = dw.removeWhite(makeCanvas(W, H), W, H);
ok('全部吃掉但 applied 仍为 true', r8.applied === true && r8.removed === W * H);
ok('removedRatio = 1', dw.removedRatio(r8) === 1);

console.log('\n[9] 空输入');
const r9 = dw.removeWhite(null, 0, 0);
ok('空图返回未处理', r9.applied === false && r9.alpha.length === 0);

console.log('\n[10] 写回 alpha');
const d10 = makeCanvas(4, 4);
const a10 = new Uint8ClampedArray(16);
a10.fill(0);
dw.applyAlpha(d10, a10);
ok('A 通道被改成 0', d10[3] === 0 && d10[15 * 4 + 3] === 0);
ok('RGB 不受影响', d10[0] === 255);

console.log('\n[11] 线稿 vs 实心主体');
// 细线画一个方框，内部全是白 —— 这就是「手绘线稿」的结构
const line = makeCanvas(W, H);
for (let x = 10; x <= 29; x++) {
  fillRect(line, W, x, 10, x, 10, [15, 15, 15]);
  fillRect(line, W, x, 29, x, 29, [15, 15, 15]);
}
for (let y = 10; y <= 29; y++) {
  fillRect(line, W, 10, y, 10, y, [15, 15, 15]);
  fillRect(line, W, 29, y, 29, y, [15, 15, 15]);
}
ok('细线画的白底 → lineart', dw.classify(line, W, H) === 'lineart', dw.classify(line, W, H));

const solid = makeCanvas(W, H);
fillRect(solid, W, 8, 8, 32, 32, [60, 60, 60]);   // 44% 的深色主体
ok('大面积实心主体 → cutout', dw.classify(solid, W, H) === 'cutout', dw.classify(solid, W, H));

const colorful = makeCanvas(W, H);
fillRect(colorful, W, 12, 12, 27, 27, [220, 90, 60]);
ok('彩色主体 → cutout（不当线稿）', dw.classify(colorful, W, H) === 'cutout', dw.classify(colorful, W, H));

ok('灰底 → none', dw.classify(midGray, W, H) === 'none', dw.classify(midGray, W, H));

// 闭合线框：泛洪从外面进不去，内部白纸会整片留下来 ——
// 这正是线稿不能复用 removeWhite、必须单独走 lineArtAlpha 的原因
const rl = dw.removeWhite(line, W, H);
ok('线条本身不透明', rl.alpha[10 * W + 20] === 255, rl.alpha[10 * W + 20]);
ok('闭合线框里泛洪进不去，白纸被留下', rl.alpha[20 * W + 20] === 255, rl.alpha[20 * W + 20]);

const la = dw.lineArtAlpha(line, W, H);
ok('线稿算法把纸全部清空（含框内）', la[20 * W + 20] === 0, la[20 * W + 20]);
ok('线稿算法保留线条', la[10 * W + 20] === 255, la[10 * W + 20]);
ok('线稿算法对外面那圈纸也透明', la[0] === 0);

console.log('\n[12] 白纸占比与墨迹画像');
ok('全白图白占比为 1', dw.whiteRatio(allWhite, W, H) === 1);
const prof = dw.inkProfile(line, W, H);
ok('线稿的墨迹占比很低', prof.darkRatio < 0.2, prof.darkRatio.toFixed(3));
ok('线稿几乎没有颜色', prof.avgChroma < 5, prof.avgChroma.toFixed(1));

console.log('\n' + '─'.repeat(48));
console.log('  通过 ' + pass + ' · 失败 ' + fail);
process.exit(fail ? 1 : 0);
