// 语义抠图云函数：用 IS-Net（isnet-general-use，ONNX）把宠物主体从任意背景里抠出来。
//
// 与本地 cutout.js（只去白底）互补：白底图本地秒出、零成本；草地/沙发等复杂背景
// 走本函数做语义分割，返回透明 PNG。结果由调用方（pet 云函数）纳入 mediaAssets
// 生命周期，隐私模式下随 24h 清理任务一并删除。
//
// 部署须知（重要）：
//   1. 模型不进函数包：把 isnet-general-use.onnx（约 178MB，fp32；或用 fp16 约 86MB）
//      上传到云存储，再在本函数的环境变量 CUTOUT_MODEL_FILE_ID 里填它的 fileID。
//      运行时首次调用下载到 /tmp 并缓存（实例复用，二次调用不再下载）。
//   2. 依赖 onnxruntime-node 体积较大，需「上传并部署：云端安装依赖」；若函数包超限，
//      可改用云函数「层」承载 onnxruntime-node，或换 fp16 模型。
//   3. 冷启动（首次或长时间未调用）+ CPU 推理 1024×1024 约需数秒到十几秒，
//      请在控制台把本函数超时调到 60s、内存调到 1024MB。
//
// 模型与预处理参数（对齐 rembg 的 isnet-general-use）：
//   - 输入 input_image: float32 [1,3,1024,1024]，RGB，归一化 (x / max - 0.5)
//   - 输出 output_image: float32 [1,1,1024,1024]，已含 sigmoid 的概率图
//   - 后处理：min-max 归一化到 [0,1] → ×255 → 回原图尺寸 → 作 alpha 通道
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const os = require('os');
const fs = require('fs');
const path = require('path');

const MODEL_INPUT = 1024;
const MODEL_FILE = 'isnet-general-use.onnx';
const MODEL_FILE_ID = process.env.CUTOUT_MODEL_FILE_ID || '';

let sessionPromise = null;

function ok(data) {
  return { ok: true, data };
}
function fail(e) {
  return { ok: false, error: (e && e.message) || '抠图失败，请重试' };
}

// 加载模型（实例级缓存：同一个云函数实例复用同一个 session，避免每次冷加载）
async function ensureModel() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = require('onnxruntime-node');
    const tmp = path.join(os.tmpdir(), MODEL_FILE);
    if (!fs.existsSync(tmp)) {
      if (!MODEL_FILE_ID) throw new Error('未配置 CUTOUT_MODEL_FILE_ID 环境变量');
      const r = await cloud.downloadFile({ fileID: MODEL_FILE_ID });
      fs.writeFileSync(tmp, r.fileContent);
    }
    return await ort.InferenceSession.create(tmp, { executionProviders: ['cpu'] });
  })().catch((e) => {
    sessionPromise = null;
    throw e;
  });
  return sessionPromise;
}

// 主流程：下载原图 → 预处理 → 推理 → 合成透明 PNG → 上传回云存储
async function runCutout(fileID) {
  const Jimp = require('jimp');
  const ort = require('onnxruntime-node');

  const dl = await cloud.downloadFile({ fileID });
  const img = await Jimp.read(dl.fileContent);
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  if (!w || !h) throw new Error('读不到这张图');

  // 预处理：等比不裁切，直接压到 1024×1024（模型输入是固定方形）
  const small = img.clone().resize(MODEL_INPUT, MODEL_INPUT);
  const sd = small.bitmap.data;
  const n = MODEL_INPUT * MODEL_INPUT;

  let maxVal = 0;
  for (let i = 0; i < n; i++) {
    const r = sd[i * 4];
    const g = sd[i * 4 + 1];
    const b = sd[i * 4 + 2];
    if (r > maxVal) maxVal = r;
    if (g > maxVal) maxVal = g;
    if (b > maxVal) maxVal = b;
  }
  maxVal = Math.max(maxVal, 1e-6);

  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = sd[i * 4] / maxVal - 0.5;
    input[n + i] = sd[i * 4 + 1] / maxVal - 0.5;
    input[2 * n + i] = sd[i * 4 + 2] / maxVal - 0.5;
  }

  const session = await ensureModel();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_INPUT, MODEL_INPUT]);
  const results = await session.run({ [inputName]: tensor });
  const mask = results[outputName].data; // Float32Array，长度 = 1*1*1024*1024

  // 后处理：min-max 归一化到 [0,1]
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  // mask 转灰度图，再放大回原图尺寸
  const maskImg = new Jimp(MODEL_INPUT, MODEL_INPUT);
  for (let i = 0; i < n; i++) {
    const v = Math.round(((mask[i] - min) / range) * 255);
    const idx = i * 4;
    maskImg.bitmap.data[idx] = v;
    maskImg.bitmap.data[idx + 1] = v;
    maskImg.bitmap.data[idx + 2] = v;
    maskImg.bitmap.data[idx + 3] = 255;
  }
  maskImg.resize(w, h);

  // 用 mask 灰度作为 alpha，合成透明 PNG
  const out = img.clone();
  const od = out.bitmap.data;
  const md = maskImg.bitmap.data;
  for (let i = 0; i < w * h; i++) {
    od[i * 4 + 3] = md[i * 4];
  }

  const png = await out.getBufferAsync(Jimp.MIME_PNG);
  const upload = await cloud.uploadFile({
    cloudPath: 'pet/cut-' + Date.now() + '.png',
    fileContent: png
  });
  return { fileID: upload.fileID, width: w, height: h };
}

exports.main = async (event) => {
  const { action, fileID } = event || {};
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '身份获取失败' };
  try {
    switch (action) {
      case 'remove':
        if (!fileID) return { ok: false, error: '缺少图片' };
        return ok(await runCutout(fileID));
      default:
        return { ok: false, error: '未知操作' };
    }
  } catch (e) {
    return fail(e);
  }
};
