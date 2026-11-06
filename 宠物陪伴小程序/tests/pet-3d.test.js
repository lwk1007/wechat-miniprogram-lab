// 照片立体实验台的页面级断言：模拟器识别、自动摆动、选图降级、去白底。
// 页面文件依赖 wx，这里用最小桩把它跑起来。不测渲染层——渲染对不对只能在开发者工具里看，
// 但「点了按钮有没有反应、选完图路径有没有写进去、卸载后定时器有没有收掉」这些能测。
const path = require('path');
const ROOT = path.join(__dirname, '..');

const calls = { toast: [], chooseMedia: 0, chooseImage: 0 };
const storage = {};

const wx = {
  getSystemInfoSync: () => ({ platform: 'devtools', windowWidth: 375, windowHeight: 667 }),
  getStorageSync: (k) => storage[k] || '',
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  showToast: (o) => calls.toast.push(o.title),
  chooseMedia: (o) => { calls.chooseMedia++; o.fail({ errMsg: 'chooseMedia:fail devtools' }); },
  chooseImage: (o) => { calls.chooseImage++; o.success({ tempFilePaths: ['http://tmp/abc.jpg'] }); },
  onDeviceMotionChange: () => {},
  startDeviceMotionListening: (o) => o.success && o.success(),
  stopDeviceMotionListening: () => {},
  offDeviceMotionChange: () => {},
  // 默认当作「不支持离屏 canvas」，需要时在用例里替换
  createOffscreenCanvas: undefined,
  getImageInfo: undefined,
  canvasToTempFilePath: undefined
};
// 其余 wx 调用一律「回调直接 success」，避免页面在无关处崩掉
global.wx = new Proxy(wx, {
  get(t, k) {
    if (k in t) return t[k];
    return (o) => { if (o && typeof o.success === 'function') o.success({}); };
  }
});

let cfg = null;
global.Page = (c) => { cfg = c; };
require(path.join(ROOT, 'miniprogram/pages/pet-3d/pet-3d.js'));

function makePage() {
  const page = Object.assign({}, cfg);
  page.data = JSON.parse(JSON.stringify(cfg.data));
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  return page;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
};

// 造一张 40×40 的白底图供离屏 canvas 桩使用。
// solid：中间一大块深色主体（判成实心图）；line：1px 线框（判成线稿）
function fakeImageData(w, h, kind) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  const ink = (x, y) => {
    const p = (y * w + x) * 4;
    data[p] = 25; data[p + 1] = 25; data[p + 2] = 25;
  };
  if (kind === 'line') {
    for (let x = 10; x <= 29; x++) { ink(x, 10); ink(x, 29); }
    for (let y = 10; y <= 29; y++) { ink(10, y); ink(29, y); }
  } else {
    for (let y = 8; y <= 31; y++) for (let x = 8; x <= 31; x++) ink(x, y);
  }
  return { data, width: w, height: h };
}

function installCanvasStub(kind) {
  let put = null;
  wx.getImageInfo = (o) => setTimeout(() => o.success({ width: 40, height: 40 }), 0);
  wx.createOffscreenCanvas = () => ({
    createImage: () => {
      const img = {};
      Object.defineProperty(img, 'src', {
        set() { setTimeout(() => img.onload && img.onload(), 0); }
      });
      return img;
    },
    getContext: () => ({
      clearRect() {},
      drawImage() {},
      getImageData: (x, y, w, h) => fakeImageData(w, h, kind),
      putImageData: (d) => { put = d; }
    })
  });
  wx.canvasToTempFilePath = (o) => setTimeout(() => o.success({ tempFilePath: 'http://tmp/cut.png' }), 0);
  return () => put;
}

// 离屏 canvas 那条链有好几层异步，固定 sleep 要么不够要么白等；轮询到条件成立为止
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

async function main() {
  console.log('\n[1] 模拟器识别');
  const p1 = makePage();
  p1.onLoad();
  p1.onShow();
  ok('devtools 直接判为 touch 模式', p1.data.sensor === 'touch', p1.data.sensor);
  ok('提示里给出「自动摆动」这条出路', /自动摆动/.test(p1.data.hint), p1.data.hint);
  ok('没有白等 1.8 秒（没挂判死定时器）', !p1._watch);

  console.log('\n[2] 自动摆动');
  const p2 = makePage();
  p2.onLoad();
  p2.toggleDemo();
  ok('按钮状态打开', p2.data.demo === true);
  ok('定时器已起', !!p2._demo);
  ok('提示切换为摆动中', /自动摆动/.test(p2.data.hint), p2.data.hint);
  // 按真实节奏推进：每帧 40ms，走 30 帧正好到四分之一圈。
  // 一次跳相位的话低通只走 22%，测出来的是滤波起手而不是实际幅度
  p2._demoT0 = Date.now() - 1800 - 30 * 40;
  for (let i = 0; i < 30; i++) {
    p2._demoT0 += 40;
    p2.stepDemo();
  }
  const quarter = p2.data.off;
  ok('接近四分之一圈时主体横向位移够看', Math.abs(quarter.mid.x) > 12, quarter.mid.x);
  ok('位移按 back < mid < front 递增',
    Math.abs(quarter.back.x) < Math.abs(quarter.mid.x) && Math.abs(quarter.mid.x) < Math.abs(quarter.front.x),
    JSON.stringify(quarter));
  p2.stopDemo();
  ok('停止后定时器清空', p2._demo === null && p2.data.demo === false);

  console.log('\n[3] 选图（chooseMedia 不可用时降级）');
  const p3 = makePage();
  p3.onLoad();
  p3.pickPhoto();
  ok('先试了 chooseMedia', calls.chooseMedia === 1);
  ok('失败后降级到 chooseImage', calls.chooseImage === 1);
  ok('照片路径写进 data', p3.data.photo === 'http://tmp/abc.jpg', p3.data.photo);
  ok('提示改成「已载入」', /已载入/.test(p3.data.hint), p3.data.hint);
  ok('换图时退回卡片模式', p3.data.mode === 'card');

  console.log('\n[4] 去白底');
  const p4 = makePage();
  p4.onLoad();
  p4.makeCutout();
  ok('没照片时不硬跑，只提示', calls.toast.indexOf('先选一张照片') > -1, calls.toast.join('/'));

  p4.setData({ photo: 'http://tmp/white.png' });
  p4.makeCutout();
  ok('基础库不支持离屏 canvas 时提示而不是崩', calls.toast.some((t) => /基础库版本/.test(t)), calls.toast.join('/'));

  const readPut = installCanvasStub('solid');
  const p5 = makePage();
  p5.onLoad();
  p5.setData({ photo: 'http://tmp/white.png' });
  p5.makeCutout();
  ok('开始处理时进入 busy 态', p5.data.working === true, p5.data.working);
  await waitFor(() => !!p5.data.cutout);
  ok('抠图结果写进 cutout', p5.data.cutout === 'http://tmp/cut.png', p5.data.cutout);
  ok('自动切到抠图模式', p5.data.mode === 'cutout', p5.data.mode);
  ok('抠图模式用更大的景深预设', p5.data.preset.front > 1.75, p5.data.preset.front);
  ok('处理完解锁按钮', p5.data.working === false);
  ok('提示里报了背景占比', /白底已去掉/.test(p5.data.hint), p5.data.hint);
  ok('实心图不翻转颜色', p5.data.invert === false);
  const put = readPut();
  ok('putImageData 用上了改过 alpha 的像素', !!put);
  if (put) {
    ok('四角 alpha 为 0', put.data[3] === 0, put.data[3]);
    ok('主体 alpha 保留', put.data[(20 * 40 + 20) * 4 + 3] === 255, put.data[(20 * 40 + 20) * 4 + 3]);
  }

  console.log('\n[5] 线稿走另一条路');
  installCanvasStub('line');
  const p7 = makePage();
  p7.onLoad();
  p7.setData({ photo: 'http://tmp/line.png' });
  p7.makeCutout();
  await waitFor(() => !!p7.data.cutout);
  ok('线稿也生成了抠图', p7.data.cutout === 'http://tmp/cut.png', p7.data.cutout);
  ok('线稿标记为需要翻色', p7.data.invert === true);
  ok('提示说明了这是线稿', /线稿/.test(p7.data.hint), p7.data.hint);

  console.log('\n[6] 卸载清理');
  const p6 = makePage();
  p6.onLoad();
  p6.toggleDemo();
  p6.onUnload();
  ok('卸载后没有残留定时器', p6._demo === null);

  console.log('\n' + '─'.repeat(48));
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  process.exit(fail ? 1 : 0);
}

main();
