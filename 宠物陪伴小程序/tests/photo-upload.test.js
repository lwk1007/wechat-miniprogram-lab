// 创建 / 编辑页与去底链路的接线
//
// 这两页最容易出的错不是算法，是时机：
//   · 选完图还没算完就点了提交 → 存成「有原图、没透明版」
//   · 处理失败却把流程挡住了 → 用户明明只想加只宠物，却被一个可选优化卡死
//   · 换了图，上一张的抠图没清 → 新照片顶着旧轮廓显示
// 这几条都测。
//
// 不测渲染：模板里到底长什么样只能在开发者工具里看。

const path = require('path');
const ROOT = path.join(__dirname, '..');

const storage = {};
const wxImpl = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getSystemInfoSync: () => ({ platform: 'devtools' }),
  showToast: () => {},
  showModal: () => {},
  navigateBack: () => {},
  reLaunch: () => {},
  previewImage: () => {},
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

const local = require(path.join(ROOT, 'miniprogram/utils/localdb'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// 等条件成立，最多等 800ms。异步链有好几层，固定 sleep 要么不够要么白等
function waitFor(fn, ms) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (fn() || Date.now() - t0 > (ms || 800)) resolve();
      else setTimeout(tick, 5);
    };
    tick();
  });
}

function loadPage(rel) {
  let captured = null;
  global.Page = (cfg) => { captured = cfg; };
  const abs = require.resolve(path.join(ROOT, rel));
  delete require.cache[abs];
  require(abs);
  return captured;
}

function makePage(cfg) {
  const p = {};
  Object.keys(cfg).forEach((k) => {
    p[k] = typeof cfg[k] === 'function' ? cfg[k].bind(p) : cfg[k];
  });
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  return p;
}

// 造像素：白底 + 中间 30% 的带色主体（真实的宠物照片/插画都有色）
function solidPixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 252; d[i * 4 + 1] = 252; d[i * 4 + 2] = 252; d[i * 4 + 3] = 255;
  }
  const x0 = Math.round(w * 0.35); const x1 = Math.round(w * 0.65);
  const y0 = Math.round(h * 0.35); const y1 = Math.round(h * 0.65);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * w + x) * 4;
      d[p] = 214; d[p + 1] = 122; d[p + 2] = 84;
    }
  }
  return d;
}
function busyPixels(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 128; d[i * 4 + 1] = 122; d[i * 4 + 2] = 116; d[i * 4 + 3] = 255;
  }
  return d;
}

// 装 canvas 桩。kind 决定读出来的像素长什么样；exportName 决定导出路径；
// delay 用来把处理人为拖慢，好测「算到一半就点了提交」这种时序
function installCanvas(kind, exportName, delay) {
  const d = delay || 0;
  wx.getImageInfo = (o) => setTimeout(() => o.success({ width: 40, height: 40 }), d);
  wx.createOffscreenCanvas = () => ({
    createImage: () => {
      const img = {};
      Object.defineProperty(img, 'src', {
        set() { setTimeout(() => img.onload && img.onload(), d); }
      });
      return img;
    },
    getContext: () => ({
      clearRect() {},
      drawImage() {},
      getImageData: (x, y, w, h) => ({ data: kind === 'busy' ? busyPixels(w, h) : solidPixels(w, h), width: w, height: h }),
      putImageData() {}
    })
  });
  wx.canvasToTempFilePath = (o) => setTimeout(() => o.success({ tempFilePath: exportName }), d);
}

function uninstallCanvas() {
  wx.getImageInfo = undefined;
  wx.createOffscreenCanvas = undefined;
  wx.canvasToTempFilePath = undefined;
}

function pickPhoto(path) {
  wx.chooseMedia = (o) => setTimeout(() => o.success({ tempFiles: [{ tempFilePath: path }] }), 0);
}

async function main() {
  console.log('\n[1] 创建页：选完图当场算，算完默认用去底版');

  installCanvas('solid', 'wxfile://create-cut.png');
  pickPhoto('wxfile://create.png');
  const createCfg = loadPage('miniprogram/pages/create/create.js');
  const c1 = makePage(createCfg);
  c1.onLoad();

  await c1.choosePhoto();
  await waitFor(() => !!c1.data.photo);
  ok('选中的图立刻显示出来', c1.data.photo === 'wxfile://create.png', c1.data.photo);

  await waitFor(() => !!c1.data.photoCut);
  ok('算出了透明版', c1.data.photoCut === 'wxfile://create-cut.png', c1.data.photoCut);
  ok('标记成实心主体', c1.data.photoCutKind === 'cutout', c1.data.photoCutKind);
  ok('默认就用去底版（用户看到的第一眼就是去完白底的样子）', c1.data.useCut === true);
  ok('算完关掉处理中状态', c1.data.photoCutting === false);
  ok('给出「去掉了多少」的说明', /白底已去掉/.test(c1.data.cutHint), c1.data.cutHint);

  c1.toggleCut();
  ok('能切回原图', c1.data.useCut === false);
  c1.toggleCut();
  ok('能再切回去底版', c1.data.useCut === true);

  console.log('\n[2] 创建页：白底之外的图不该挡住流程');

  installCanvas('busy', 'wxfile://never.png');
  const c2 = makePage(loadPage('miniprogram/pages/create/create.js'));
  c2.onLoad();
  await c2.choosePhoto();
  await waitFor(() => !!c2.data.photo);
  await waitFor(() => c2.data.photoCutting === false);
  ok('原图照样保留', c2.data.photo === 'wxfile://create.png', c2.data.photo);
  ok('没有透明版', c2.data.photoCut === '', c2.data.photoCut);
  ok('不会默认用去底版', c2.data.useCut === false);
  ok('说明里点出「背景里有东西」而不是报错', /背景里有东西/.test(c2.data.cutHint), c2.data.cutHint);

  console.log('\n[3] 创建页：提交时把两份都存下来');

  installCanvas('solid', 'wxfile://submit-cut.png');
  storage['demo_pet'] = '';
  const c3 = makePage(loadPage('miniprogram/pages/create/create.js'));
  c3.onLoad();
  await c3.choosePhoto();
  await waitFor(() => !!c3.data.photoCut);
  c3.setData({ name: '毛毛', personality: 'loyal', step: 3, mode: 'private' });
  await c3.submit();
  const saved = await local.getPet();
  ok('档案建出来了', !!saved, saved && saved.name);
  ok('原图存进档案', saved.photo === 'wxfile://create.png', saved.photo);
  ok('透明版也存进档案', saved.photoCut === 'wxfile://submit-cut.png', saved.photoCut);
  ok('类型跟着存', saved.photoCutKind === 'cutout', saved.photoCutKind);

  console.log('\n[4] 创建页：选了原图就只存原图，不留孤儿文件');

  storage['demo_pet'] = '';
  const c4 = makePage(loadPage('miniprogram/pages/create/create.js'));
  c4.onLoad();
  await c4.choosePhoto();
  await waitFor(() => !!c4.data.photoCut);
  c4.toggleCut(); // 用户觉得原图好
  c4.setData({ name: '毛毛', personality: 'loyal', step: 3, mode: 'private' });
  await c4.submit();
  const kept = await local.getPet();
  ok('只存了原图', kept.photo === 'wxfile://create.png', kept.photo);
  ok('没有透明版', kept.photoCut === '', kept.photoCut);

  console.log('\n[5] 创建页：算到一半点提交，要等它算完');

  // 把处理拖慢到 30ms，才有机会在「算完之前」按下提交
  installCanvas('solid', 'wxfile://submit-cut.png', 30);
  const c5 = makePage(loadPage('miniprogram/pages/create/create.js'));
  c5.onLoad();
  await c5.choosePhoto();
  await waitFor(() => !!c5.data.photo);
  ok('此刻还在算', c5.data.photoCutting === true, c5.data.photoCutting);
  c5.setData({ name: '毛毛', personality: 'loyal', step: 3, mode: 'private' });
  await c5.submit(); // submit 内部会 await 那次计算
  const raced = await local.getPet();
  ok('没有丢成「有原图、没透明版」', raced.photoCut === 'wxfile://submit-cut.png', raced.photoCut);

  console.log('\n[6] 创建页：删掉照片要把透明版一起清');

  const c6 = makePage(loadPage('miniprogram/pages/create/create.js'));
  c6.onLoad();
  await c6.choosePhoto();
  await waitFor(() => !!c6.data.photoCut);
  c6.removePhoto();
  ok('原图清掉', c6.data.photo === '');
  ok('透明版清掉', c6.data.photoCut === '');

  console.log('\n[7] 编辑页：换图同样算一次，保存时一起提交');

  storage['demo_pet'] = '';
  await local.createPet({
    name: '毛毛', personality: 'loyal', type: 'cat',
    photo: 'wxfile://old.png', photoCut: 'wxfile://old-cut.png', photoCutKind: 'cutout'
  });
  installCanvas('solid', 'wxfile://edit-cut.png');
  pickPhoto('wxfile://edit.png');
  const e1 = makePage(loadPage('miniprogram/pages/pet-edit/pet-edit.js'));
  e1.onLoad();
  await waitFor(() => e1.data.loading === false);
  ok('读到了原来的照片', e1.data.photo === 'wxfile://old.png', e1.data.photo);

  await e1.choosePhoto();
  await waitFor(() => !!e1.data.newPhotoCut);
  ok('新图的透明版算出来了', e1.data.newPhotoCut === 'wxfile://edit-cut.png', e1.data.newPhotoCut);

  await e1.save();
  const edited = await local.getPet();
  ok('照片换成新的', edited.photo === 'wxfile://edit.png', edited.photo);
  ok('透明版换成新的（不是旧的 old-cut）', edited.photoCut === 'wxfile://edit-cut.png', edited.photoCut);

  console.log('\n[8] 编辑页：新图处理不了，旧轮廓必须被清掉');

  storage['demo_pet'] = '';
  await local.createPet({
    name: '毛毛', personality: 'loyal', type: 'cat',
    photo: 'wxfile://old.png', photoCut: 'wxfile://old-cut.png', photoCutKind: 'cutout'
  });
  installCanvas('busy', 'wxfile://never.png');
  const e2 = makePage(loadPage('miniprogram/pages/pet-edit/pet-edit.js'));
  e2.onLoad();
  await waitFor(() => e2.data.loading === false);
  await e2.choosePhoto();
  await waitFor(() => !!e2.data.newPhoto);
  await waitFor(() => e2.data.photoCutting === false);
  ok('没有新透明版', e2.data.newPhotoCut === '', e2.data.newPhotoCut);
  await e2.save();
  const after = await local.getPet();
  ok('照片换掉了', after.photo === 'wxfile://edit.png', after.photo);
  ok('上一张的轮廓没有残留', after.photoCut === '', after.photoCut);

  uninstallCanvas();

  console.log('\n' + '─'.repeat(48));
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('测试自身出错:', e);
  process.exit(1);
});
