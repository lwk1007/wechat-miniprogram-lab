const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 静默登录：以 openid 建立数据归属，不依赖客户端传参
exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '身份获取失败' };
  const users = db.collection('users');
  const found = await users.where({ _openid: OPENID }).limit(1).get();
  if (found.data.length === 0) {
    await users.add({
      data: { _openid: OPENID, nickname: '', createdAt: Date.now() }
    });
  }
  return { ok: true, data: { uid: OPENID } };
};
