const timeCapsule = require('../../utils/time-capsule');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function dateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 'YYYY-MM-DD' → 本地当天 00:00 的时间戳（不用 new Date(str)，它会按 UTC 解析、差 8 小时）
function dayStart(str) {
  const p = String(str || '').split('-');
  const y = Number(p[0]); const m = Number(p[1]); const d = Number(p[2]);
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d).getTime();
}

function cnDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

Page({
  data: {
    capsules: [],
    showForm: false,
    title: '',
    content: '',
    unlockDate: '',
    minDate: '',
    maxDate: '',
    saving: false,
    opening: null
  },

  onLoad() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const max = new Date(now.getFullYear() + 10, now.getMonth(), now.getDate());
    this.setData({
      minDate: dateStr(tomorrow),
      maxDate: dateStr(max)
    });
  },

  onShow() {
    this.load();
  },

  load() {
    const now = Date.now();
    const capsules = timeCapsule.list().map((c) => Object.assign({}, c, {
      unlocked: timeCapsule.isUnlocked(c, now),
      countdown: timeCapsule.countdownText(c, now),
      dateText: cnDate(c.createdAt),
      openText: c.openedAt ? cnDate(c.openedAt) : ''
    }));
    this.setData({ capsules });
  },

  showForm() { this.setData({ showForm: true }); },
  hideForm() { this.setData({ showForm: false, title: '', content: '', unlockDate: '' }); },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onContent(e) { this.setData({ content: e.detail.value }); },
  onDate(e) { this.setData({ unlockDate: e.detail.value }); },

  save() {
    if (this.data.saving) return;
    const content = (this.data.content || '').trim();
    if (!content) {
      wx.showToast({ title: '写下想对未来说的话吧', icon: 'none' });
      return;
    }
    if (!this.data.unlockDate) {
      wx.showToast({ title: '请选一个开启的日期', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      timeCapsule.add({ title: this.data.title, content, unlockAt: dayStart(this.data.unlockDate) });
      this.setData({ showForm: false, title: '', content: '', unlockDate: '' });
      this.load();
      wx.showToast({ title: '已埋下', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '埋下失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  onTapCapsule(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.capsules.find((c) => c._id === id);
    if (!item) return;
    if (!item.unlocked) {
      wx.showToast({ title: item.countdown || '还没到开启的时间', icon: 'none' });
      return;
    }
    // 解锁后第一次点：开启仪式，记录 openedAt
    if (!item.openedAt) {
      timeCapsule.open(id);
      this.setData({ opening: Object.assign({}, item, { openedAt: true }) });
      this.load();
    }
    // 已经开启过的，内容直接在列表里展开了，无需再处理
  },

  closeOpen() { this.setData({ opening: null }); },

  removeCapsule(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这颗胶囊',
      content: '删除后无法恢复，确定吗？',
      confirmColor: '#D97A6C',
      success: (r) => {
        if (!r.confirm) return;
        timeCapsule.remove(id);
        this.load();
      }
    });
  }
});
