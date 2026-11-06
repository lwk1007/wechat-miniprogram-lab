// 照片去底链路的断言
//
// 分两段：
//   1. utils/cutout.js —— 画布那层的接线：缩放、读像素、判定、导出。dewhite 本身在
//      dewhte.test.js 里已经测透了，这里只测「有没有把它接对」。
//   2. 档案里的生命周期 —— photoCut 是 photo 的衍生数据，最容易出的错是「换了图，
//      上一张的轮廓还留着」。这条规则必须钉住。
//
// 为什么不用真图片：这条链路的输入是像素数组，用生成的图能把边界情况造得比照片更狠。

const path = require('path');
const ROOT = path.join(__dirname, '..');

// ---------- wx 最小桩 ----------
// 先装一个「什么都能调、但 canvas 相关一律不存在」的 wx，
// 这样模块加载阶段不会炸，同时 supported() 默认是 false。
const storage = {};
const wxImpl = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getSystemInfoSync: () => ({ platform: 'devtools' }),
  showToast: () => {},
  // 显式置空：supported() 要看到这三个不存在
  getImageInfo: undefined,
  createOffscreenCanvas: undefined,
  canvasToTempFilePath: undefined
};
global.wx = new Proxy(wxImpl, {
  get(t, k) {
    if (k in t) return t[k];
    return (o) => { if (o && typeof o.success === 'function') o.success({}); };
  },
  set(t, k, v) { t[k] = v; return true; }
});

const cutout = require(path.join(ROOT, 'miniprogram/utils/cutout'));
const local = require(path.join(ROOT, 'miniprogram/utils/localdb'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// ---------- 造图 ----------
// 主体位置按比例给，这样同一套桩换任何画布尺寸都成立
// 40×40：白底 + 中间 35%~65% 的带色主体 → 实心主体
function solidPixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 252; d[i * 4 + 1] = 252; d[i * 4 + 2] = 252; d[i * 4 + 3] = 255;
  }
  const x0 = Math.round(w * 0.35);
  const x1 = Math.round(w * 0.65);
  const y0 = Math.round(h * 0.35);
  const y1 = Math.round(h * 0.65);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * w + x) * 4;
      d[p] = 214; d[p + 1] = 122; d[p + 2] = 84;  // 有色：真实的宠物照片/插画都有色
    }
  }
  return d;
}
// 白底 + 中间一块无色的深灰小方块 → 会被判成线稿（dewhite 里写明的已知局限）
function grayBlobPixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 252; d[i * 4 + 1] = 252; d[i * 4 + 2] = 252; d[i * 4 + 3] = 255;
  }
  const x0 = Math.round(w * 0.4);
  const x1 = Math.round(w * 0.6);
  const y0 = Math.round(h * 0.4);
  const y1 = Math.round(h * 0.6);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * w + x) * 4;
      d[p] = 40; d[p + 1] = 40; d[p + 2] = 44;
    }
  }
  return d;
}
// 白底 + 1px 黑方框 → 线稿（方框是闭合的，泛洪进不去，必须走线稿那条路）
function linePixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 252; d[i * 4 + 1] = 252; d[i * 4 + 2] = 252; d[i * 4 + 3] = 255;
  }
  const x0 = Math.round(w * 0.25);
  const x1 = Math.round(w * 0.75);
  const y0 = Math.round(h * 0.25);
  const y1 = Math.round(h * 0.75);
  const ink = (x, y) => {
    const p = (y * w + x) * 4;
    d[p] = 25; d[p + 1] = 25; d[p + 2] = 25;
  };
  for (let x = x0; x <= x1; x++) { ink(x, y0); ink(x, y1); }
  for (let y = y0; y <= y1; y++) { ink(x0, y); ink(x1, y); }
  return d;
}
// 白底 + 几根互不相连的线 → 什么都没围住，去完只剩线条
function strokesPixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 252; d[i * 4 + 1] = 252; d[i * 4 + 2] = 252; d[i * 4 + 3] = 255;
  }
  const ink = (x, y) => {
    const p = (y * w + x) * 4;
    d[p] = 25; d[p + 1] = 25; d[p + 2] = 25;
  };
  for (let x = 8; x <= 31; x++) ink(x, Math.round(h * 0.4));
  for (let y = Math.round(h * 0.55); y <= Math.round(h * 0.8); y++) ink(Math.round(w * 0.3), y);
  return d;
}
// 满屏中灰 → 背景里有东西，不该动
function busyPixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 130; d[i * 4 + 1] = 124; d[i * 4 + 2] = 118; d[i * 4 + 3] = 255;
  }
  return d;
}
function allWhitePixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 253; d[i * 4 + 1] = 253; d[i * 4 + 2] = 253; d[i * 4 + 3] = 255;
  }
  return d;
}

const SOURCES = { solidPixels, grayBlobPixels, linePixels, strokesPixels, busyPixels, allWhitePixels };

// 装一套能跑的 canvas 桩。pixelKind 决定读出来的像素长什么样
function installCanvas(pixelKind, opts) {
  const o = opts || {};
  const seen = { canvasOpts: null, put: null, exported: null };
  wx.getImageInfo = (arg) => {
    if (o.imageFail) { arg.fail && arg.fail({ errMsg: 'read fail' }); return; }
    const size = o.size || { width: 40, height: 40 };
    setTimeout(() => arg.success({ width: size.width, height: size.height }), 0);
  };
  wx.createOffscreenCanvas = (canvasOpts) => {
    seen.canvasOpts = canvasOpts;
    const gen = SOURCES[pixelKind];
    return {
      createImage: () => {
        const img = {};
        Object.defineProperty(img, 'src', {
          set() { setTimeout(() => (img.onload ? img.onload() : img.onerror && img.onerror()), 0); }
        });
        return img;
      },
      getContext: () => ({
        clearRect() {},
        drawImage() {},
        getImageData: (x, y, w, h) => ({ data: gen(w, h), width: w, height: h }),
        putImageData: (d) => { seen.put = d; }
      })
    };
  };
  wx.canvasToTempFilePath = (arg) => {
    if (o.exportFail) { arg.fail && arg.fail({ errMsg: 'export fail' }); return; }
    seen.exported = arg;
    setTimeout(() => arg.success({ tempFilePath: 'wxfile://cut-' + pixelKind + '.png' }), 0);
  };
  return seen;
}

function resetCanvas() {
  wx.getImageInfo = undefined;
  wx.createOffscreenCanvas = undefined;
  wx.canvasToTempFilePath = undefined;
}

// 拿到 reject 的 code，断言失败时能看出到底为什么拒绝
function codeOf(err) {
  return (err && err.code) || ('<无 code: ' + JSON.stringify(err) + '>');
}

async function main() {
  console.log('\n[1] 环境与尺寸');

  resetCanvas();
  ok('缺 API 时 supported() 为 false', cutout.supported() === false);
  let err = await cutout.cut('wxfile://a.png').then(() => null, (e) => e);
  ok('缺 API 时直接拒绝，不抛未捕获异常', codeOf(err) === 'unsupported', codeOf(err));

  installCanvas('solidPixels');
  ok('API 齐备时 supported() 为 true', cutout.supported() === true);

  const big = cutout.fitSize(2000, 1000);
  ok('长边超限缩到 MAX_EDGE', Math.max(big.w, big.h) === cutout.MAX_EDGE, JSON.stringify(big));
  ok('缩放保持长宽比', big.w === cutout.MAX_EDGE && big.h === cutout.MAX_EDGE / 2, JSON.stringify(big));
  const small = cutout.fitSize(300, 200);
  ok('小图不放大', small.w === 300 && small.h === 200, JSON.stringify(small));
  const zero = cutout.fitSize(0, 0);
  ok('零尺寸不返回 0（会崩 canvas）', zero.w >= 1 && zero.h >= 1, JSON.stringify(zero));

  console.log('\n[2] 实心主体：白底透明、主体留着');

  const s1 = installCanvas('solidPixels');
  let res = await cutout.cut('wxfile://solid.png').then((r) => r, (e) => e);
  ok('判成实心主体', res.kind === 'cutout', res.kind);
  ok('导出的是 png', s1.exported && s1.exported.fileType === 'png', s1.exported && s1.exported.fileType);
  ok('拿回临时路径', res.path === 'wxfile://cut-solidPixels.png', res.path);
  ok('去掉了大部分白底', res.ratio > 0.7 && res.ratio < 0.99, res.ratio);
  ok('写回了改过 alpha 的像素', !!s1.put);
  if (s1.put) {
    const d = s1.put.data;
    ok('四角完全透明', d[3] === 0, d[3]);
    ok('主体中心不透明', d[(20 * 40 + 20) * 4 + 3] === 255, d[(20 * 40 + 20) * 4 + 3]);
  }

  console.log('\n[3] 手绘稿：轮廓里的白是主体，不能被挖空');

  const l1 = installCanvas('linePixels');
  const r2 = await cutout.cut('wxfile://line.png').then((r) => r, (e) => e);
  ok('闭合轮廓判成带填充的主体', r2.kind === 'cutout', r2.kind);
  if (l1.put) {
    const d = l1.put.data;
    ok('线条不透明', d[(10 * 40 + 20) * 4 + 3] === 255, d[(10 * 40 + 20) * 4 + 3]);
    ok('方框里的白纸保留（身体不镂空）', d[(20 * 40 + 20) * 4 + 3] === 255, d[(20 * 40 + 20) * 4 + 3]);
    ok('四角透明', d[3] === 0, d[3]);
  }

  console.log('\n[4] 什么都没围住的墨线：只留线条');

  // 白纸上只有几根线，没有可称为「身体」的封闭区域 —— 这时候去掉全部纸是对的，
  // 但要说清楚：它只是外观判断（决定夜间要不要反色），不参与去底决策。
  const g1 = installCanvas('strokesPixels');
  const r3 = await cutout.cut('wxfile://gray.png').then((r) => r, (e) => e);
  ok('判成只剩线条（夜里要翻成亮色）', r3.kind === 'line', r3.kind);
  if (g1.put) {
    const d = g1.put.data;
    ok('纸去干净了', d[3] === 0, d[3]);
    ok('线条留着', d[(Math.round(40 * 0.4) * 40 + 20) * 4 + 3] === 255, d[(Math.round(40 * 0.4) * 40 + 20) * 4 + 3]);
  }

  console.log('\n[5] 该拒绝的时候拒绝');

  installCanvas('busyPixels');
  err = await cutout.cut('wxfile://busy.png').then(() => null, (e) => e);
  ok('背景有东西 → not-white', codeOf(err) === 'not-white', codeOf(err));

  installCanvas('allWhitePixels');
  err = await cutout.cut('wxfile://white.png').then(() => null, (e) => e);
  ok('全白 → all-white（一个墨点都没有）', codeOf(err) === 'all-white', codeOf(err));

  installCanvas('solidPixels');
  err = await cutout.cut('').then(() => null, (e) => e);
  ok('没给图 → no-src', codeOf(err) === 'no-src', codeOf(err));

  installCanvas('solidPixels', { imageFail: true });
  err = await cutout.cut('wxfile://broken.png').then(() => null, (e) => e);
  ok('读不到图 → read-fail', codeOf(err) === 'read-fail', codeOf(err));

  installCanvas('solidPixels', { exportFail: true });
  err = await cutout.cut('wxfile://x.png').then(() => null, (e) => e);
  ok('导出失败 → export-fail', codeOf(err) === 'export-fail', codeOf(err));

  console.log('\n[6] 大图按缩放后的尺寸建画布');

  const s2 = installCanvas('solidPixels', { size: { width: 2000, height: 1000 } });
  await cutout.cut('wxfile://huge.png');
  ok('画布宽等于 MAX_EDGE', s2.canvasOpts.width === cutout.MAX_EDGE, s2.canvasOpts.width);
  ok('画布高按比例', s2.canvasOpts.height === cutout.MAX_EDGE / 2, s2.canvasOpts.height);

  console.log('\n[7] 给用户看的说明');

  ok('实心主体说去掉了多少背景', /白底已去掉.*% 是背景/.test(cutout.describe({ kind: 'cutout', ratio: 0.83 })), cutout.describe({ kind: 'cutout', ratio: 0.83 }));
  ok('只剩线条时说清没说全', /线条/.test(cutout.describe({ kind: 'line', ratio: 0.17 })), cutout.describe({ kind: 'line', ratio: 0.17 }));
  ok('没有结果时返回空串', cutout.describe(null) === '');

  console.log('\n[8] 档案里：photoCut 是 photo 的衍生数据');

  wx.setStorageSync('demo_pet', '');
  let pet = await local.createPet({ name: '毛毛', personality: 'loyal', type: 'cat', photo: 'wxfile://p.png' });
  ok('没处理过的照片不带透明版', pet.photoCut === '' && pet.photoCutKind === '', pet.photoCut);

  pet = await local.createPet({
    name: '毛毛', personality: 'loyal', type: 'cat',
    photo: 'wxfile://p.png', photoCut: 'wxfile://p-cut.png', photoCutKind: 'cutout'
  });
  ok('透明版存住了', pet.photoCut === 'wxfile://p-cut.png', pet.photoCut);
  ok('类型也存住了', pet.photoCutKind === 'cutout', pet.photoCutKind);
  ok('原图仍保留（没有拿透明版盖掉原图）', pet.photo === 'wxfile://p.png', pet.photo);

  pet = await local.updatePet({ photo: 'wxfile://new.png' });
  ok('换图没带新透明版 → 旧的一起清掉', pet.photoCut === '' && pet.photoCutKind === '', pet.photoCut);

  pet = await local.updatePet({ photo: 'wxfile://new2.png', photoCut: 'wxfile://new2-cut.png', photoCutKind: 'line' });
  ok('换图带新透明版 → 换成新的', pet.photoCut === 'wxfile://new2-cut.png', pet.photoCut);
  ok('类型跟着换', pet.photoCutKind === 'line', pet.photoCutKind);

  pet = await local.updatePet({ name: '改个名' });
  ok('只改名字不动透明版', pet.photoCut === 'wxfile://new2-cut.png', pet.photoCut);

  pet = await local.updatePet({ photoCut: '', photoCutKind: '' });
  ok('显式传空串能清掉透明版', pet.photoCut === '' && pet.photoCutKind === '', pet.photoCut);

  await local.removePhoto();
  pet = await local.getPet();
  ok('立即删除照片时透明版一起删', pet.photo === '' && pet.photoCut === '', pet.photo + '/' + pet.photoCut);

  resetCanvas();

  console.log('\n' + '─'.repeat(48));
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('测试自身出错:', e);
  process.exit(1);
});
