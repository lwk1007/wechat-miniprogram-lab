/**
 * 数据层：演示模式（本地缓存）/ 云开发模式
 *
 * 页面只认这里的方法，不出现 wx.cloud。
 * 演示模式下图片会被转成 base64 存进缓存，所以重开小程序还能看到。
 */

const config = require('./config')

const IS_CLOUD = !!config.envId
const POSTS_KEY = 'demo_posts'
const LIKES_KEY = 'demo_likes' // { postId: true }
const DEMO_MAX_POSTS = 30
const DEMO_MAX_IMAGES = 3 // 每帖最多存 3 张图，防止缓存爆掉

// 同一毫秒连发两条会撞时间戳，点赞是按 postId 索引的，重复 ID 会串号
const localId = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/* ------------------------- 工具 ------------------------- */

function timeAgo(ts) {
  const diff = Date.now() - Number(ts || 0)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  return day < 30 ? `${day} 天前` : `${Math.floor(day / 30)} 个月前`
}

function toBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(`data:image/jpeg;base64,${res.data}`),
      fail: reject
    })
  })
}

const readPosts = () => wx.getStorageSync(POSTS_KEY) || []
const writePosts = (list) => wx.setStorageSync(POSTS_KEY, list)
const readLikes = () => wx.getStorageSync(LIKES_KEY) || {}

/* ------------------------- 演示模式 ------------------------- */

async function publishLocal({ nickname, content, tempPaths }) {
  const images = []
  for (const path of tempPaths.slice(0, DEMO_MAX_IMAGES)) {
    const compressed = await wx.compressImage({ src: path, quality: 45 })
    images.push(await toBase64(compressed.tempFilePath))
  }

  const post = {
    _id: localId(),
    nickname,
    content,
    images,
    likeCount: 0,
    createdAt: Date.now()
  }

  writePosts([post].concat(readPosts()).slice(0, DEMO_MAX_POSTS))
  return post
}

/* ------------------------- 云开发模式 ------------------------- */

async function publishCloud({ nickname, content, tempPaths }) {
  // 并发上传，任一失败就整体失败，避免发出半截内容
  const images = await Promise.all(
    tempPaths.map(async (path, i) => {
      const ext = (path.match(/\.(\w+)$/) || [, 'jpg'])[1]
      const res = await wx.cloud.uploadFile({
        cloudPath: `posts/${Date.now()}-${i}.${ext}`,
        filePath: path
      })
      return res.fileID
    })
  )

  await wx.cloud.database().collection(config.collection).add({
    data: { nickname, content, images, likeCount: 0, createdAt: Date.now() }
  })

  return true
}

/* ------------------------- 对外统一接口 ------------------------- */

module.exports = {
  isCloud: IS_CLOUD,
  timeAgo,

  // 返回 { posts, myLikes, hasMore }
  async listPage(page, pageSize) {
    if (!IS_CLOUD) {
      const all = readPosts()
      const slice = all.slice(page * pageSize, (page + 1) * pageSize)
      return {
        posts: slice.map((p) => Object.assign({}, p, { timeText: timeAgo(p.createdAt) })),
        myLikes: readLikes(),
        hasMore: (page + 1) * pageSize < all.length
      }
    }

    const db = wx.cloud.database()

    const postRes = await db
      .collection(config.collection)
      .orderBy('createdAt', 'desc')
      .skip(page * pageSize)
      .limit(pageSize)
      .get()

    // 点赞记录单独存，权限「仅创建者可读写」→ 这里查到的天然只有我自己
    const likeRes = await db.collection('likes').limit(100).get()
    const myLikes = {}
    likeRes.data.forEach((l) => {
      myLikes[l.postId] = l._id
    })

    return {
      posts: postRes.data.map((p) => Object.assign({}, p, { timeText: timeAgo(p.createdAt) })),
      myLikes,
      hasMore: postRes.data.length === pageSize
    }
  },

  // 传入当前帖子和"我点过没"的凭据，返回新的点赞状态
  async toggleLike(post, likeRecordId) {
    if (!IS_CLOUD) {
      const likes = readLikes()
      const posts = readPosts()
      const idx = posts.findIndex((p) => p._id === post._id)
      const liked = !!likes[post._id]

      if (liked) delete likes[post._id]
      else likes[post._id] = true

      if (idx > -1) {
        posts[idx].likeCount = Math.max(0, (posts[idx].likeCount || 0) + (liked ? -1 : 1))
      }

      wx.setStorageSync(LIKES_KEY, likes)
      writePosts(posts)

      return {
        liked: !liked,
        likeCount: idx > -1 ? posts[idx].likeCount : (liked ? 0 : 1)
      }
    }

    const db = wx.cloud.database()

    if (likeRecordId) {
      // 取消：删点赞记录 + 计数减一（用 command.inc 做原子自增，避免并发覆盖）
      await db.collection('likes').doc(likeRecordId).remove()
      await db.collection(config.collection).doc(post._id).update({
        data: { likeCount: db.command.inc(-1) }
      })
      return { liked: false, likeCount: Math.max(0, (post.likeCount || 0) - 1) }
    }

    const added = await db.collection('likes').add({
      data: { postId: post._id, createdAt: Date.now() }
    })
    await db.collection(config.collection).doc(post._id).update({
      data: { likeCount: db.command.inc(1) }
    })
    return { liked: true, likeCount: (post.likeCount || 0) + 1, likeRecordId: added._id }
  },

  async publish(payload) {
    return IS_CLOUD ? publishCloud(payload) : publishLocal(payload)
  }
}
