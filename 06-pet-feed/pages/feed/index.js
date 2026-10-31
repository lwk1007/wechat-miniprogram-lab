const api = require('../../api')
const config = require('../../config')

const PAGE = config.pageSize

Page({
  data: {
    isCloud: api.isCloud,
    posts: [],
    page: 0,
    loading: false,
    noMore: false,
    myLikes: {}, // { postId: 凭据 }，用来判断"我点过没"
    tip: ''
  },

  onLoad() {
    this.loadPage(0)
  },

  onShow() {
    // 从发布页回来要刷新。用标记位而不是无条件刷新，避免每次切回来都重拉
    if (this._dirty) {
      this._dirty = false
      this.loadPage(0)
    }
  },

  async loadPage(page) {
    if (this.data.loading) return
    this.setData({ loading: true, tip: '' })

    try {
      const { posts, myLikes, hasMore } = await api.listPage(page, PAGE)

      this.setData({
        posts: page === 0 ? posts : this.data.posts.concat(posts),
        page: page + 1,
        noMore: !hasMore,
        loading: false,
        myLikes: page === 0 ? myLikes : Object.assign({}, this.data.myLikes, myLikes)
      })
    } catch (err) {
      this.setData({
        loading: false,
        tip: `加载失败：${err.errMsg || err.message}（检查 posts / likes 集合是否已创建）`
      })
    }
  },

  onPullDownRefresh() {
    this.loadPage(0).then(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.noMore || this.data.loading) return
    this.loadPage(this.data.page)
  },

  async toggleLike(e) {
    const { id } = e.currentTarget.dataset
    const target = this.data.posts.find((p) => p._id === id)
    if (!target) return

    try {
      const r = await api.toggleLike(target, this.data.myLikes[id])

      const myLikes = Object.assign({}, this.data.myLikes)
      if (r.liked) myLikes[id] = r.likeRecordId || true
      else delete myLikes[id]

      this.setData({ myLikes })
      this.patchPost(id, r.likeCount)
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' })
      console.error('[like]', err)
    }
  },

  // 只改一条的点赞数，不整列表 setData —— 列表长了这个差异很明显
  patchPost(id, likeCount) {
    const posts = this.data.posts.map((p) => (p._id === id ? Object.assign({}, p, { likeCount }) : p))
    this.setData({ posts })
  },

  previewImage(e) {
    const { src, urls } = e.currentTarget.dataset
    wx.previewImage({ current: src, urls })
  },

  goPublish() {
    this._dirty = true
    wx.navigateTo({ url: '/pages/publish/index' })
  }
})
