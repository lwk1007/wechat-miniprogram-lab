// 统一 API 门面：云模式调用云函数，演示模式走本地数据层
const cloudSvc = require('./cloud');
const local = require('./localdb');

function useCloud() {
  return cloudSvc.isCloudReady();
}

module.exports = {
  isDemo() {
    return !useCloud();
  },

  // ---------- 用户 ----------
  ensureUser() {
    return useCloud() ? cloudSvc.call('login', 'login') : local.ensureUser();
  },

  // ---------- 宠物 ----------
  getPet() {
    return useCloud() ? cloudSvc.call('pet', 'get') : local.getPet();
  },
  createPet(data) {
    return useCloud() ? cloudSvc.call('pet', 'create', data) : local.createPet(data);
  },
  updatePet(patch) {
    return useCloud() ? cloudSvc.call('pet', 'update', patch) : local.updatePet(patch);
  },
  deletePet() {
    return useCloud() ? cloudSvc.call('pet', 'delete') : local.deletePet();
  },

  // ---------- 数据管理（隐私专项）----------
  // 立即删除照片：不必等隐私模式的 22 小时自动过期
  removePhoto() {
    return useCloud() ? cloudSvc.call('account', 'removePhoto') : local.removePhoto();
  },
  // 清空全部数据：与 deletePet 不同，连社区动态、评论、点赞一起删
  purgeAll() {
    return useCloud() ? cloudSvc.call('account', 'purge') : local.purgeAll();
  },
  // 导出我的数据（查阅 / 复制权）
  exportMyData() {
    return useCloud() ? cloudSvc.call('account', 'export') : local.exportAll();
  },

  // ---------- 一封信 ----------
  // stats 来自 utils/moments.js 的本机汇总，只上传次数与场景名，不上传聊天原文
  getLetter() {
    return useCloud() ? cloudSvc.call('letter', 'latest') : local.getLetter();
  },
  generateLetter(payload) {
    return useCloud() ? cloudSvc.call('letter', 'generate', payload || {}) : local.generateLetter(payload || {});
  }
};
