// 照片去底：把「白底照片裁成一张贴纸」这件事在本地解决掉，不接分割接口。
//
// 只做纯本地计算：读图 → 从四边泛洪吃掉背景纸 → 导出透明 PNG。
// 主体轮廓内的像素原样保留，所以白底上的白主体不会被挖空。
// 一次几十毫秒，不上传、不耗流量。
//
// 失败不是错误，是常态：宠物蹲在沙发上、背景是花纹地毯，这类图本来就不该动。
// 调用方拿到 reject 应该当「没处理」继续走，不能挡住创建流程。
const dewhite = require('./dewhite');

// 处理上限。桌面上的宠物最长边也就 300px 上下，再大只是拖慢 getImageData。
// 手机拍的 4000×3000 直接读进 ImageData 是 48MB，低端机会直接被系统杀掉。
const MAX_EDGE = 720;

// 这些 API 要基础库 2.16.1+。老版本或模拟器缺一个就整条链路不可用
function supported() {
  return !!(wx.createOffscreenCanvas && wx.canvasToTempFilePath && wx.getImageInfo);
}

function fail(code, hint) {
  return { code, hint };
}

// 最长边缩到 MAX_EDGE 以内，并保持长宽比
function fitSize(width, height) {
  const long = Math.max(width || 0, height || 0);
  if (!long) return { w: 1, h: 1 };
  const scale = Math.min(1, MAX_EDGE / long);
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale))
  };
}

// 把一张本地图读成 ImageData。canvas 的尺寸是缩放后的，不是原图尺寸
function readFrame(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: (info) => resolve(info),
      fail: () => reject(fail('read-fail', '读不到这张图'))
    });
  }).then((info) => new Promise((resolve, reject) => {
    const size = fitSize(info.width, info.height);
    const canvas = wx.createOffscreenCanvas({ type: '2d', width: size.w, height: size.h });
    const img = canvas.createImage();
    img.onload = () => {
      let ctx;
      try {
        ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size.w, size.h);
        ctx.drawImage(img, 0, 0, size.w, size.h);
      } catch (e) {
        reject(fail('canvas-fail', '这张图解码失败'));
        return;
      }
      resolve({ canvas, ctx, w: size.w, h: size.h });
    };
    img.onerror = () => reject(fail('decode-fail', '这张图打不开'));
    img.src = src;
  }));
}

// 主流程：判定类型 → 算 alpha → 写回画布 → 导出 PNG
function cut(src) {
  if (!src) return Promise.reject(fail('no-src', '还没有照片'));
  if (!supported()) return Promise.reject(fail('unsupported', '这个环境不支持本地处理'));

  return readFrame(src).then((frame) => new Promise((resolve, reject) => {
    const { canvas, ctx, w, h } = frame;
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      reject(fail('pixel-fail', '读不到这张图的像素'));
      return;
    }

    const res = dewhite.removeWhite(data.data, w, h);
    if (!res.applied) {
      // 四边不是白的，说明背景里有东西 —— 这是分割接口的活，不是这里的
      reject(fail('not-white', '背景不是纯白'));
      return;
    }
    const ratio = dewhite.removedRatio(res);
    // 一个墨点都没有 = 空图。不能用「去掉了 97%」当判据：
    // 稀疏的线稿本来就 98% 是纸，那样会被误杀。
    if (res.removed >= res.total) {
      reject(fail('all-white', '整张几乎全白'));
      return;
    }

    // 保留下来多少纸白，决定这张在桌面上的样子：轮廓闭合时身体里的白留着，
    // 这个数就大；线条没围住东西时它接近 0，说明只剩线条。
    // 只有「白纸 + 墨线」的图才认这种情况，彩色实心主体不会被误当成线稿翻色。
    const kept = dewhite.keptRatio(res);
    const prof = dewhite.inkProfile(data.data, w, h);
    const inkDrawing = prof.whiteRatio >= dewhite.LINEART_WHITE
      && prof.avgChroma <= dewhite.LINEART_CHROMA
      && prof.darkRatio <= dewhite.LINEART_DARK;
    const kind = (kept < 0.02 && inkDrawing) ? 'line' : 'cutout';

    dewhite.applyAlpha(data.data, res.alpha);
    try {
      ctx.putImageData(data, 0, 0);
    } catch (e) {
      reject(fail('write-fail', '写不回画布'));
      return;
    }
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      success: (out) => resolve({ path: out.tempFilePath, kind, ratio }),
      fail: () => reject(fail('export-fail', '导出失败'))
    });
  }));
}

// 给 UI 用的一句话说明。ratio 是「去掉了多少」
function describe(res) {
  if (!res) return '';
  const pct = Math.round((res.ratio || 0) * 100);
  return res.kind === 'line'
    ? '背景已去掉，只留下线条（线条没围住身体）'
    : '白底已去掉（' + pct + '% 是背景）';
}

module.exports = {
  MAX_EDGE,
  supported,
  fitSize,
  cut,
  describe
};
