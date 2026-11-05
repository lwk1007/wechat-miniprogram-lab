const api = require('../../utils/api');

const PAGE_SIZE = 10;
const MODE_KEY = 'community_mode';       // 记住上次用的浏览模式
const PREFETCH_AHEAD = 3;                // 还剩几条时就开始预加载

Page({
  data: {
    // feed = 沉浸式全屏上下滑（默认）；list = 卡片列表（类似朋友圈的浏览方式）
    mode: 'feed',
    statusBarHeight: 20,
    // 自绘导航必须避开右上角的微信胶囊按钮，否则按钮会被它压住
    navTop: 26,
    navH: 32,
    navPadRight: 108,
    current: 0,
    showHint: false,

    posts: [],
    loading: true,
    loadingMore: false,
    hasMore: true,
    error: '',
    nextCursor: null,

    // 评论面板
    panel: {
      visible: false,
      postId: '',
      post: null,
      comments: [],
      input: '',
      loading: false,
      submitting: false
    }
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const saved = wx.getStorageSync(MODE_KEY);
    // 胶囊按钮的真实位置：用它算出「顶部对齐点」和「右侧要留多宽」
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const statusBarHeight = (info && info.statusBarHeight) || 20;
    const winWidth = (info && info.windowWidth) || 375;
    const navTop = menu && menu.top ? menu.top : statusBarHeight + 6;
    const navH = menu && menu.height ? menu.height : 32;
    // 右侧留白 = 屏幕宽 - 胶囊左边缘 + 一点间隙；拿不到数据时给个保守值
    const navPadRight = menu && menu.left ? Math.round(winWidth - menu.left + 12) : 108;
    this.setData({
      statusBarHeight,
      navTop,
      navH,
      navPadRight,
      mode: saved === 'list' ? 'list' : 'feed'
    });
  },

  onShow() {
    const app = getApp();
    if (app.globalData.communityDirty) {
      app.globalData.communityDirty = false;
      this.reload();
    }
  },

  onUnload() {
    clearTimeout(this._hintTimer);
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.mode !== 'list') return;
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.loadMore();
  },

  // ---------- 浏览模式 ----------
  switchMode() {
    const mode = this.data.mode === 'feed' ? 'list' : 'feed';
    wx.setStorageSync(MODE_KEY, mode);
    this.setData({ mode });
    wx.showToast({ title: mode === 'feed' ? '沉浸式浏览' : '列表浏览', icon: 'none' });
  },

  // ---------- 数据 ----------
  // 给每条动态预计算封面，避免在 WXML 里堆条件表达式
  decorate(list) {
    return list.map((p) => {
      const images = p.images || [];
      return Object.assign({}, p, {
        cover: images.length ? images[0] : '',
        imageCount: images.length
      });
    });
  },

  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await api.listPosts({ limit: PAGE_SIZE });
      const posts = this.decorate(res.list);
      this.setData({
        posts,
        current: 0,
        nextCursor: res.nextCursor,
        hasMore: !!res.nextCursor,
        loading: false
      });
      this.maybeShowHint(posts.length);
    } catch (e) {
      this.setData({ loading: false, error: e.message || '加载失败，下拉重试' });
    }
  },

  async loadMore() {
    this.setData({ loadingMore: true });
    try {
      const res = await api.listPosts({ limit: PAGE_SIZE, cursor: this.data.nextCursor });
      this.setData({
        posts: this.data.posts.concat(this.decorate(res.list)),
        nextCursor: res.nextCursor,
        hasMore: !!res.nextCursor,
        loadingMore: false
      });
    } catch (e) {
      this.setData({ loadingMore: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  // 首屏给一次「上滑」提示，之后不再打扰
  maybeShowHint(count) {
    if (count < 2 || this._hintShown) return;
    this._hintShown = true;
    this.setData({ showHint: true });
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.setData({ showHint: false }), 3200);
  },

  // 滑动切换：更新序号，快到底部时预取下一页
  onSwipe(e) {
    const current = e.detail.current;
    this.setData({ current, showHint: false });
    const { posts, hasMore, loading, loadingMore } = this.data;
    if (hasMore && !loading && !loadingMore && current >= posts.length - PREFETCH_AHEAD) {
      this.loadMore();
    }
  },

  onRefresh() {
    wx.showToast({ title: '刷新中', icon: 'none' });
    this.reload();
  },

  previewImage(e) {
    const { urls, current } = e.currentTarget.dataset;
    wx.previewImage({ urls, current });
  },

  // 点赞 / 取消点赞（乐观更新，失败回滚）
  async toggleLike(e) {
    const id = e.currentTarget.dataset.id;
    const idx = this.data.posts.findIndex((p) => p._id === id);
    if (idx < 0) return;
    const post = this.data.posts[idx];
    const liked = !post.liked;
    this.setData({
      ['posts[' + idx + '].liked']: liked,
      ['posts[' + idx + '].likeCount']: post.likeCount + (liked ? 1 : -1)
    });
    try {
      await api.toggleLike(id, liked);
    } catch (err) {
      this.setData({
        ['posts[' + idx + '].liked']: post.liked,
        ['posts[' + idx + '].likeCount']: post.likeCount
      });
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  // 更多操作：删除自己的动态 / 举报
  more(e) {
    const id = e.currentTarget.dataset.id;
    const post = this.data.posts.find((p) => p._id === id);
    if (!post) return;
    const items = post.mine ? ['删除这条动态', '举报'] : ['举报'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const label = items[res.tapIndex];
        if (label === '举报') this.report(post);
        else if (label === '删除这条动态') this.deletePost(post);
      }
    });
  },

  deletePost(post) {
    wx.showModal({
      title: '删除动态',
      content: '删除后动态、评论、点赞和图片都会一并删除，确定吗？',
      confirmColor: '#D97A6C',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.deletePost(post._id);
          this.setData({ posts: this.data.posts.filter((p) => p._id !== post._id) });
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' });
        }
      }
    });
  },

  report(post) {
    wx.showActionSheet({
      itemList: ['垃圾内容', '不友善内容', '其他'],
      success: async (r) => {
        const reasons = ['垃圾内容', '不友善内容', '其他'];
        try {
          await api.reportPost(post._id, reasons[r.tapIndex]);
          wx.showToast({ title: '已收到举报，待处理', icon: 'none' });
        } catch (e) {
          wx.showToast({ title: e.message || '提交失败', icon: 'none' });
        }
      }
    });
  },

  // ---------- 评论面板 ----------
  async openComments(e) {
    const id = e.currentTarget.dataset.id;
    const post = this.data.posts.find((p) => p._id === id);
    this.setData({ panel: { visible: true, postId: id, post, comments: [], input: '', loading: true, submitting: false } });
    try {
      const comments = await api.listComments(id);
      this.setData({ 'panel.comments': comments, 'panel.loading': false });
    } catch (err) {
      this.setData({ 'panel.loading': false });
      wx.showToast({ title: err.message || '评论加载失败', icon: 'none' });
    }
  },

  closePanel() {
    this.setData({ 'panel.visible': false });
  },

  noop() {},

  onPanelInput(e) {
    this.setData({ 'panel.input': e.detail.value });
  },

  async submitComment() {
    const text = this.data.panel.input.trim();
    if (!text) {
      wx.showToast({ title: '评论不能为空', icon: 'none' });
      return;
    }
    if (this.data.panel.submitting) return;
    this.setData({ 'panel.submitting': true });
    try {
      const c = await api.addComment(this.data.panel.postId, text);
      // 成功后才清空输入；失败时保留输入内容
      this.setData({
        'panel.comments': this.data.panel.comments.concat([Object.assign({ timeText: '刚刚' }, c)]),
        'panel.input': '',
        'panel.submitting': false
      });
      const idx = this.data.posts.findIndex((p) => p._id === this.data.panel.postId);
      if (idx >= 0) this.setData({ ['posts[' + idx + '].commentCount']: this.data.posts[idx].commentCount + 1 });
    } catch (e) {
      // 失败：保留输入内容，提示错误
      this.setData({ 'panel.submitting': false });
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    }
  },

  deleteComment(e) {
    const cid = e.currentTarget.dataset.id;
    const c = this.data.panel.comments.find((x) => x._id === cid);
    if (!c || !c.mine) return;
    wx.showModal({
      title: '删除评论',
      content: '确定删除这条评论吗？',
      confirmColor: '#D97A6C',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.deleteComment(this.data.panel.postId, cid);
          this.setData({ 'panel.comments': this.data.panel.comments.filter((x) => x._id !== cid) });
          const idx = this.data.posts.findIndex((p) => p._id === this.data.panel.postId);
          if (idx >= 0) this.setData({ ['posts[' + idx + '].commentCount']: Math.max(0, this.data.posts[idx].commentCount - 1) });
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      }
    });
  },

  goPublish() {
    wx.navigateTo({ url: '/pages/publish/publish' });
  }
});
