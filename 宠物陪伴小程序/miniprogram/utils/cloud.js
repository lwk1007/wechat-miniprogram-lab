// 云服务封装：统一入口，未配置环境时全站进入演示模式
const config = require('./config');

let ready = false;

function init() {
  if (ready) return true;
  if (!config.cloudEnvId) return false;
  if (!wx.cloud) return false;
  try {
    wx.cloud.init({ env: config.cloudEnvId, traceUser: true });
    ready = true;
  } catch (e) {
    ready = false;
    console.warn('云环境初始化失败，进入演示模式', e && e.message);
  }
  return ready;
}

function isCloudReady() {
  return ready;
}

// 统一调用云函数，服务端返回 { ok, data, error }
function call(name, action, data = {}) {
  if (!ready) return Promise.reject(new Error('云服务未配置'));
  return wx.cloud.callFunction({ name, data: Object.assign({ action }, data) }).then((res) => {
    const r = res && res.result;
    if (!r || r.ok === false) {
      throw new Error((r && r.error) || '服务异常，请稍后重试');
    }
    return r.data;
  });
}

function upload(cloudPath, filePath) {
  if (!ready) return Promise.reject(new Error('云服务未配置'));
  return wx.cloud.uploadFile({ cloudPath, filePath }).then((r) => r.fileID);
}

module.exports = { init, isCloudReady, call, upload };
