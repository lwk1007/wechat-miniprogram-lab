const api = require('../../utils/api');
const moments = require('../../utils/moments');
const petLife = require('../../utils/pet-life');

const TITLE_KEY = 'pet_owner_title';

Page({
  data: {
    loading: true,
    error: '',
    writing: false,
    letter: null,
    paras: [],
    dateText: '',
    isDemo: true,
    petName: '',
    photo: '',
    typeEmoji: '🐾',
    ownerTitle: '妈妈',
    // 冷却
    canWrite: false,
    cooldownText: '',
    // 这封信参考了多少互动
    sourceText: ''
  },

  onLoad() {
    let title = '妈妈';
    try {
      const saved = wx.getStorageSync(TITLE_KEY);
      if (saved) title = saved;
    } catch (e) { /* 用默认称呼 */ }
    this.setData({ ownerTitle: title });
    this.load(title);
  },

  onUnload() {
    clearInterval(this._tick);
  },

  async load(title) {
    this.setData({ loading: true, error: '' });
    try {
      await api.ensureUser();
      const pet = await api.getPet();
      if (!pet) {
        this.setData({ loading: false, error: '还没有宠物，先去创建一个吧' });
        return;
      }
      const owner = pet.ownerTitle || title || '妈妈';
      this.setData({
        petName: pet.name || '它',
        photo: (pet.photo && !this.photoExpired(pet)) ? pet.photo : '',
        typeEmoji: this.emojiOf(pet.type),
        ownerTitle: owner,
        isDemo: api.isDemo(),
        loading: false
      });

      const res = await api.getLetter();
      if (res && res.letter) {
        this.applyLetter(res.letter, res.nextAt);
      } else {
        this.setData({ letter: null, paras: [], canWrite: true, cooldownText: '' });
      }
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败，请重试' });
    }
  },

  photoExpired(pet) {
    return pet.storageMode === 'private' && pet.photoExpiresAt && Date.now() > pet.photoExpiresAt;
  },

  emojiOf(type) {
    if (type === 'cat') return '🐱';
    if (type === 'dog') return '🐶';
    return '🐾';
  },

  applyLetter(letter, nextAt) {
    const blocks = String(letter.content || '')
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    const last = blocks.length - 1;
    const paras = blocks.map((text, i) => ({
      key: i,
      text,
      // 第一行是「妈妈：」这样的称呼，最后一行是署名
      greet: i === 0 && /[:：]$/.test(text) && text.length <= 12,
      sign: i === last && i > 0 && text.length <= 12 && text.indexOf('\n') < 0
    }));

    const s = letter.stats || {};
    const bits = [];
    if (s.activeDays) bits.push(`${s.activeDays} 天里你来过`);
    const acts = [];
    if (s.feed) acts.push(`喂食 ${s.feed} 次`);
    if (s.play) acts.push(`玩耍 ${s.play} 次`);
    if (s.touch) acts.push(`摸摸 ${s.touch} 次`);
    if (s.lift) acts.push(`拎起来 ${s.lift} 次`);
    const sourceText = (bits.concat(acts).join('、') || '你们的互动') + '，写成了这封信';

    this.setData({
      letter,
      paras,
      dateText: this.dateOf(letter.createdAt),
      canWrite: false,
      sourceText
    });
    this.startCooldown(nextAt);
  },

  dateOf(ts) {
    const d = new Date(ts || Date.now());
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  },

  startCooldown(nextAt) {
    clearInterval(this._tick);
    if (!nextAt) {
      this.setData({ canWrite: true, cooldownText: '' });
      return;
    }
    const tick = () => {
      const left = nextAt - Date.now();
      if (left <= 0) {
        clearInterval(this._tick);
        this.setData({ canWrite: true, cooldownText: '' });
        return;
      }
      this.setData({ canWrite: false, cooldownText: this.humanLeft(left) });
    };
    tick();
    this._tick = setInterval(tick, 30000);
  },

  humanLeft(ms) {
    const m = Math.ceil(ms / 60000);
    if (m < 60) return m + ' 分钟';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? h + ' 小时 ' + mm + ' 分钟' : h + ' 小时';
  },

  async write() {
    if (this.data.writing || !this.data.canWrite) return;
    this.setData({ writing: true, error: '' });
    try {
      // 只上传汇总结论：次数、天数、场景名，不传聊天原文
      const stats = moments.summary();
      // 它最近自己在做什么。云端只用来给信加一句生活细节，不上传别的本机数据
      let activityLabel = '';
      try { activityLabel = petLife.summary().activityLabel; } catch (e2) { /* ignore */ }
      const res = await api.generateLetter({ ownerTitle: this.data.ownerTitle, stats, activityLabel });
      if (!res || !res.letter) throw new Error('它好像走神了，再试一次吧');
      this.applyLetter(res.letter, res.nextAt);
      wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    } catch (e) {
      this.setData({ error: (e && e.message) || '写信失败，请稍后重试' });
    } finally {
      this.setData({ writing: false });
    }
  },

  // 复制正文，方便用户留存
  copy() {
    const letter = this.data.letter;
    if (!letter) return;
    wx.setClipboardData({
      data: letter.content,
      success: () => wx.showToast({ title: '已复制这封信', icon: 'none' })
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/companion/companion' })
    });
  },

  loadRetry() {
    this.load(this.data.ownerTitle);
  }
});
