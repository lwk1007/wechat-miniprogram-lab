const config = require('../../config')
const PAGE = config.pageSize

const db = () => wx.cloud.database()

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

Page({
  data: {
    envReady: false,
    posts: [],
    page: 0,
    loading: false,
    noMore: false,
    myLikes: {}, // { postId: likeRecordId }，用来判断"我点过没"
    tip: ''
  },

  onLoad() {
    const envReady = getApp().globalData.envReady
    this.setData({ envReady })
    if (envReady) this.loadPage(0)
  },

  onShow() {
    // 从发布页回来要刷新。用标记位而不是无条件刷新，避免每次切 tab 都重新拉
    if (this._dirty && getApp().globalData.envReady) {
      this._dirty = false
      this.loadPage(0)
    }
  },

  async loadPage(page) {
    if (this.data.loading) return
    this.setData({ loading: true, tip: '' })

    try {
      const postRes = await db()
        .collection(config.collection)
        .orderBy('createdAt', 'desc')
        .skip(page * PAGE)
        .limit(PAGE)
        .get()

      const fresh = postRes.data.map((p) => Object.assign({}, p, { timeText: timeAgo(p.createdAt) }))

      // 点赞记录存在独立集合 likes，权限「仅创建者可读写」→ 这里查到的天然只有我自己
      const likeRes = await db().collection('likes').limit(100).get()
      const myLikes = Object.assign({}, page === 0 ? {} : this.data.myLikes)
      likeRes.data.forEach((l) => {
        myLikes[l.postId] = l._id
      })

      this.setData({
        posts: page === 0 ? fresh : this.data.posts.concat(fresh),
        page: page + 1,
        noMore: fresh.length < PAGE,
        loading: false,
        myLikes
      })
    } catch (err) {
      this.setData({
        loading: false,
        tip: `加载失败：${err.errMsg || err.message}（检查 posts / likes 集合是否已创建）`
      })
    }
  },

  onPullDownRefresh() {
    if (!this.data.envReady) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadPage(0).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.noMore || this.data.loading) return
    this.loadPage(this.data.page)
  },

  // 点赞：拆成两个集合，避免"改别人帖子"的权限问题
  async toggleLike(e) {
    const { id } = e.currentTarget.dataset
    const likedId = this.data.myLikes[id]
    const target = this.data.posts.find((p) => p._id === id)
    if (!target) return

    try {
      if (likedId) {
        await db().collection('likes').doc(likedId).remove()
        await db().collection(config.collection).doc(id).update({ data: { likeCount: db().command.inc(-1) } })

        const myLikes = Object.assign({}, this.data.myLikes)
        delete myLikes[id]
        this.setData({ myLikes })
        this.patchPost(id, Math.max(0, (target.likeCount || 0) - 1))
      } else {
        const added = await db().collection('likes').add({ data: { postId: id, createdAt: Date.now() } })
        await db().collection(config.collection).doc(id).update({ data: { likeCount: db().command.inc(1) } })

        this.setData({ myLikes: Object.assign({}, this.data.myLikes, { [id]: added._id }) })
        this.patchPost(id, (target.likeCount || 0) + 1)
      }
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
      console.error('[like]', err)
    }
  },

  // 只改一条的点赞数，不整列表 setData —— 列表大了这个差异很明显
  patchPost(id, likeCount) {
    const posts = this.data.posts.map((p) => (p._id === id ? Object.assign({}, p, { likeCount }) : p))
    this.setData({ posts })
  },

  previewImage(e) {
    const { src, urls } = e.currentTarget.dataset
    wx.previewImage({ current: src, urls })
  },

  goPublish() {
    if (!this.data.envReady) {
      wx.showModal({
        title: '还没配置云环境',
        content: '打开 config.js 填 envId，并建 posts、likes 两个集合。',
        showCancel: false
      })
      return
    }
    this._dirty = true
    wx.navigateTo({ url: '/pages/publish/index' })
  }
})
