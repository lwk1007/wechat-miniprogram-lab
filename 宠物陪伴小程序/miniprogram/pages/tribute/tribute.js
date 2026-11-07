const tribute = require('../../utils/tribute');

Page({
  data: {
    content: '',
    sending: false,
    letters: [],
    litCount: 0,
    ceremony: null
  },

  onLoad() {
    this.load();
  },

  load() {
    const letters = tribute.list().map((l) => Object.assign({}, l, { dateText: this.dateOf(l.createdAt) }));
    this.setData({
      letters,
      litCount: letters.filter((l) => l.lit).length
    });
  },

  dateOf(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  },

  onContent(e) {
    this.setData({ content: e.detail.value });
  },

  send() {
    if (this.data.sending) return;
    const text = (this.data.content || '').trim();
    if (!text) {
      wx.showToast({ title: '想说点什么，再寄给它吧', icon: 'none' });
      return;
    }
    this.setData({ sending: true });
    try {
      const letter = tribute.add(text);
      this.setData({ content: '', ceremony: { letter, lit: false } });
    } finally {
      this.setData({ sending: false });
    }
  },

  light() {
    const c = this.data.ceremony;
    if (!c || c.lit) return;
    tribute.lightCandle(c.letter._id);
    this.setData({ 'ceremony.lit': true });
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* ignore */ }
    }
  },

  closeCeremony() {
    this.setData({ ceremony: null });
    this.load();
  }
});
