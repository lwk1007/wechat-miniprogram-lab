// 统一 API 门面：云模式调用云函数，演示模式走本地数据层
const cloudSvc = require('./cloud');
const local = require('./localdb');

function useCloud() {
  return cloudSvc.isCloudReady();
}

function cloudPath(prefix, ext) {
  return prefix + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + (ext || '.jpg');
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

  // ---------- 对话 ----------
  getChatHistory() {
    return useCloud() ? cloudSvc.call('chat', 'history') : local.getChatHistory();
  },
  sendChat(text) {
    return useCloud() ? cloudSvc.call('chat', 'send', { text }) : local.sendChat(text);
  },

  // ---------- 一封信（AI 总结近期生活事件）----------
  // stats 来自 utils/moments.js 的本机汇总，只上传次数与场景名，不上传聊天原文
  getLetter() {
    return useCloud() ? cloudSvc.call('letter', 'latest') : local.getLetter();
  },
  generateLetter(payload) {
    return useCloud() ? cloudSvc.call('letter', 'generate', payload || {}) : local.generateLetter(payload || {});
  },

  // ---------- 社区 ----------
  listPosts(opts) {
    return useCloud() ? cloudSvc.call('community', 'list', opts || {}) : local.listPosts(opts);
  },
  listMyPosts() {
    return useCloud() ? cloudSvc.call('community', 'mine') : local.listMyPosts();
  },
  // 图片：云模式先上传云存储再发布；演示模式直接使用本地临时路径
  // ownerName 仅为展示昵称，由服务端忽略客户端身份，数据归属以 openid 为准
  async publishPost({ content, imagePaths, ownerName }) {
    if (!useCloud()) return local.publishPost({ content, images: imagePaths });
    const images = [];
    for (let i = 0; i < (imagePaths || []).length; i++) {
      const fileID = await cloudSvc.upload(cloudPath('post'), imagePaths[i]);
      images.push(fileID);
    }
    return cloudSvc.call('community', 'publish', { content, images, ownerName });
  },
  deletePost(postId) {
    return useCloud() ? cloudSvc.call('community', 'delete', { postId }) : local.deletePost(postId);
  },
  toggleLike(postId, liked) {
    return useCloud()
      ? cloudSvc.call('community', liked ? 'like' : 'unlike', { postId })
      : local.toggleLike(postId, liked);
  },
  listComments(postId) {
    return useCloud() ? cloudSvc.call('community', 'commentList', { postId }) : local.listComments(postId);
  },
  addComment(postId, content) {
    return useCloud() ? cloudSvc.call('community', 'commentAdd', { postId, content }) : local.addComment(postId, content);
  },
  deleteComment(postId, commentId) {
    return useCloud() ? cloudSvc.call('community', 'commentDelete', { postId, commentId }) : local.deleteComment(postId, commentId);
  },
  reportPost(postId, reason) {
    return useCloud() ? cloudSvc.call('community', 'report', { postId, reason }) : local.reportPost(postId, reason);
  }
};
