const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 定时清理任务：每小时执行一次（见 config.json 触发器）
// 设计要点：
// 1. 可重复执行（幂等）：以 status + expiresAt 为准，已清理的记录不会重复处理
// 2. 隐私模式素材有效期设为 22h + 每小时清理，实际保留时间必然 < 24h
// 3. 社区公开素材（purpose='post'）不参与过期清理，仅随动态删除
// 4. replaced（用户换下来的旧照片）必须一起清理：
//    否则每换一次照片就有一份旧文件永久留在云存储里，隐私模式的承诺直接失效
const BATCH = 100;
const CLEANABLE = ['active', 'failed', 'replaced'];
const MAX_ROUNDS = 5;

async function cleanupMedia() {
  const now = Date.now();
  let cleaned = 0;
  let failed = 0;

  // 单轮只处理 100 条，积压时连跑几轮，避免长期积压
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const batch = await cleanOneBatch(now);
    cleaned += batch.cleaned;
    failed += batch.failed;
    if (batch.cleaned + batch.failed < BATCH) break;
  }
  return { cleaned, failed };
}

async function cleanOneBatch(now) {
  const r = await db.collection('mediaAssets')
    .where({
      status: _.in(CLEANABLE),
      purpose: 'pet',
      expiresAt: _.lt(now)
    })
    .limit(BATCH)
    .get();

  let cleaned = 0;
  let failed = 0;
  for (const a of r.data) {
    try {
      if (a.fileID) {
        await cloud.deleteFile({ fileList: [a.fileID] }).catch(() => {
          // 文件可能已不存在，删除记录仍继续
        });
      }
      await db.collection('mediaAssets').doc(a._id).update({
        data: { status: 'cleaned', cleanedAt: now }
      });
      // 同步把引用该素材的宠物切回通用形象
      const pets = await db.collection('pets').where({ assetId: a._id }).get();
      for (const p of pets.data) {
        await db.collection('pets').doc(p._id).update({
          data: { photo: '', assetId: '' }
        }).catch(() => {});
      }
      cleaned++;
    } catch (e) {
      // 记录失败，下一轮自动重试
      await db.collection('mediaAssets').doc(a._id).update({
        data: { status: 'failed', lastError: (e.message || '').slice(0, 100), retryCount: _.inc(1) }
      }).catch(() => {});
      failed++;
    }
  }
  return { cleaned, failed };
}

// 对话历史保留 90 天，到期删除；同样多跑几轮，最多清 500 条/次
async function cleanupMessages() {
  const deadline = Date.now() - 90 * 24 * 3600 * 1000;
  let removed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const r = await db.collection('messages')
      .where({ createdAt: _.lt(deadline) })
      .limit(BATCH)
      .remove()
      .catch(() => ({ stats: { removed: 0 } }));
    const n = (r && r.stats && r.stats.removed) || 0;
    removed += n;
    if (n < BATCH) break;
  }
  return { removed };
}

exports.main = async () => {
  const media = await cleanupMedia();
  const messages = await cleanupMessages();
  return {
    ok: true,
    data: { media, messages, ranAt: Date.now() }
  };
};
