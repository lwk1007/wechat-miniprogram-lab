// 照片去底：把「白底照片裁成一张贴纸」这件事在本地解决掉，不接分割接口。
//
// 只做纯本地计算：读图 → 判定这张是实心主体还是线稿 → 算 alpha → 导出透明 PNG。
// 一次几毫秒到几十毫秒，不上传、不耗流量。
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

    const kind = dewhite.classify(data.data, w, h);
    if (kind === 'none') {
      // 四边不是白的，说明背景里有东西 —— 这是分割接口的活，不是这里的
      reject(fail('not-white', '背景不是纯白'));
      return;
    }

    let alpha;
    let ratio;
    if (kind === 'lineart') {
      // 线稿不能走泛洪：笔画一闭口，身体里的白纸就锁在里面了。
      // 它要的是「所有纸都透明、只留线条」，所以按亮度直接定透明度。
      alpha = dewhite.lineArtAlpha(data.data, w, h);
      ratio = 1 - dewhite.whiteRatio(data.data, w, h);
      if (ratio < 0.02) {
        reject(fail('no-line', '整张几乎是白纸，没找到线条'));
        return;
      }
    } else {
      // 实心主体：从四边往里泛洪，只吃和边框连着的近白。白猫胸口那种内部白会留着
      const res = dewhite.removeWhite(data.data, w, h);
      if (!res.applied) {
        reject(fail('not-white', '边框白色只占 ' + Math.round(res.borderRatio * 100) + '%'));
        return;
      }
      alpha = res.alpha;
      ratio = dewhite.removedRatio(res);
      if (ratio > 0.97) {
        reject(fail('all-white', '整张几乎全白'));
        return;
      }
    }

    dewhite.applyAlpha(data.data, alpha);
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

// 给 UI 用的一句话说明。ratio 是「去掉了多少」（线稿是「有内容的部分」的补数）
function describe(res) {
  if (!res) return '';
  const pct = Math.round((res.ratio || 0) * 100);
  return res.kind === 'lineart'
    ? '白纸已去掉，只留线条（' + pct + '% 是纸）'
    : '白底已去掉（' + pct + '% 是背景）';
}

module.exports = {
  MAX_EDGE,
  supported,
  fitSize,
  cut,
  describe
};
