const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PAGE_SIZE = 10;
const MAX_CONTENT = 500;
const MAX_COMMENT = 200;
const MAX_IMAGES = 3;

function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: (e && e.message) || '服务异常，请稍后重试' }; }

// 稳定游标分页：按 createdAt 倒序，游标为上一页最后一条的 createdAt
async function list(openid, { cursor, limit }) {
  const size = Math.min(parseInt(limit, 10) || PAGE_SIZE, 20);
  let query = db.collection('posts');
  const where = cursor ? { createdAt: _.lt(cursor) } : { createdAt: _.lt(Date.now() + 1) };
  const r = await query.where(where).orderBy('createdAt', 'desc').limit(size).get();

  const posts = r.data;
  // 批量查我是否点过赞
  const ids = posts.map((p) => p._id);
  let likedSet = {};
  if (ids.length) {
    const likes = await db.collection('likes')
      .where({ _openid: openid, postId: _.in(ids) })
      .get();
    likes.data.forEach((l) => { likedSet[l.postId] = true; });
  }
  const list = posts.map((p) => ({
    _id: p._id,
    ownerName: p.ownerName || '小伙伴',
    content: p.content || '',
    images: p.images || [],
    likeCount: p.likeCount || 0,
    commentCount: p.commentCount || 0,
    createdAt: p.createdAt,
    liked: !!likedSet[p._id],
    mine: p._openid === openid
  }));
  const nextCursor = list.length === size ? list[list.length - 1].createdAt : null;
  return ok({ list, nextCursor });
}

async function mine(openid) {
  const r = await db.collection('posts')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok(r.data.map((p) => ({
    _id: p._id,
    ownerName: p.ownerName || '小伙伴',
    content: p.content || '',
    images: p.images || [],
    likeCount: p.likeCount || 0,
    commentCount: p.commentCount || 0,
    createdAt: p.createdAt,
    liked: false,
    mine: true
  })));
}

async function publish(openid, { content, images, ownerName }) {
  const text = (content || '').trim();
  const imgs = Array.isArray(images) ? images.slice(0, MAX_IMAGES) : [];
  if (!text && imgs.length === 0) throw new Error('写点什么或添加一张图片吧');
  if (text.length > MAX_CONTENT) throw new Error('正文最多 500 字');
  // 社区公开素材：独立用途标记，不受宠物隐私模式清理影响
  const post = await db.collection('posts').add({
    data: {
      _openid: openid,
      ownerName: (ownerName || '小伙伴').slice(0, 12),
      content: text,
      images: imgs,
      likeCount: 0,
      commentCount: 0,
      createdAt: Date.now()
    }
  });
  return ok({ _id: post._id });
}

async function removePost(openid, postId) {
  if (!postId) throw new Error('参数错误');
  const r = await db.collection('posts').doc(postId).get().catch(() => null);
  if (!r || !r.data) throw new Error('动态不存在');
  // 服务端验证所有权
  if (r.data._openid !== openid) throw new Error('只能删除自己的动态');
  // 删除关联评论、点赞与存储文件
  await db.collection('comments').where({ postId }).remove().catch(() => {});
  await db.collection('likes').where({ postId }).remove().catch(() => {});
  const fileList = (r.data.images || []).filter((f) => f);
  if (fileList.length) await cloud.deleteFile({ fileList }).catch(() => {});
  await db.collection('posts').doc(postId).remove();
  return ok({ deleted: true });
}

async function like(openid, { postId }) {
  if (!postId) throw new Error('参数错误');
  const exists = await db.collection('likes').where({ _openid: openid, postId }).limit(1).get();
  if (exists.data.length) throw new Error('已经点过赞啦');
  await db.collection('likes').add({ data: { _openid: openid, postId, createdAt: Date.now() } });
  await db.collection('posts').doc(postId).update({ data: { likeCount: _.inc(1) } });
  return ok({ liked: true });
}

async function unlike(openid, { postId }) {
  if (!postId) throw new Error('参数错误');
  const exists = await db.collection('likes').where({ _openid: openid, postId }).limit(1).get();
  if (!exists.data.length) throw new Error('还没有点赞哦');
  await db.collection('likes').where({ _openid: openid, postId }).remove();
  // 只有存在点赞记录才允许取消，因此 likeCount 不会减为负数
  await db.collection('posts').doc(postId).update({
    data: { likeCount: _.inc(-1) }
  }).catch(() => {});
  return ok({ liked: false });
}

async function commentList(openid, { postId }) {
  if (!postId) throw new Error('参数错误');
  const r = await db.collection('comments')
    .where({ postId })
    .orderBy('createdAt', 'asc')
    .limit(100)
    .get();
  return ok(r.data.map((c) => ({
    _id: c._id,
    ownerName: c.ownerName || '小伙伴',
    content: c.content,
    createdAt: c.createdAt,
    mine: c._openid === openid
  })));
}

async function commentAdd(openid, { postId, content, ownerName }) {
  const text = (content || '').trim();
  if (!postId) throw new Error('参数错误');
  if (!text) throw new Error('评论内容不能为空');
  if (text.length > MAX_COMMENT) throw new Error('评论最多 200 字');
  const c = await db.collection('comments').add({
    data: {
      _openid: openid,
      postId,
      ownerName: (ownerName || '小伙伴').slice(0, 12),
      content: text,
      createdAt: Date.now()
    }
  });
  await db.collection('posts').doc(postId).update({ data: { commentCount: _.inc(1) } });
  return ok({ _id: c._id });
}

async function commentDelete(openid, { postId, commentId }) {
  if (!postId || !commentId) throw new Error('参数错误');
  const r = await db.collection('comments').doc(commentId).get().catch(() => null);
  if (!r || !r.data) throw new Error('评论不存在');
  if (r.data._openid !== openid) throw new Error('只能删除自己的评论');
  await db.collection('comments').doc(commentId).remove();
  await db.collection('posts').doc(postId).update({
    data: { commentCount: _.inc(-1) }
  }).catch(() => {});
  return ok({ deleted: true });
}

async function report(openid, { postId, reason }) {
  if (!postId) throw new Error('参数错误');
  // 实际保存举报记录，状态为待处理；未接入人工审核服务前不展示“已处理/已通过审核”结论
  await db.collection('reports').add({
    data: {
      _openid: openid,
      postId,
      reason: (reason || '其他').slice(0, 50),
      status: 'pending',
      createdAt: Date.now()
    }
  });
  return ok({ reported: true });
}

exports.main = async (event) => {
  const { action, ...payload } = event || {};
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '身份获取失败' };
  try {
    switch (action) {
      case 'list': return await list(OPENID, payload);
      case 'mine': return await mine(OPENID);
      case 'publish': return await publish(OPENID, payload);
      case 'delete': return await removePost(OPENID, payload.postId);
      case 'like': return await like(OPENID, payload);
      case 'unlike': return await unlike(OPENID, payload);
      case 'commentList': return await commentList(OPENID, payload);
      case 'commentAdd': return await commentAdd(OPENID, payload);
      case 'commentDelete': return await commentDelete(OPENID, payload);
      case 'report': return await report(OPENID, payload);
      default: return { ok: false, error: '未知操作' };
    }
  } catch (e) {
    return fail(e);
  }
};
