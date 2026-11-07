const api = require('../../utils/api');
const petLife = require('../../utils/pet-life');
const together = require('../../utils/together');
const tribute = require('../../utils/tribute');
const voiceMemory = require('../../utils/voice-memory');
const memory = require('../../utils/memory-timeline');

Page({
  data: {
    loading: true,
    error: '',
    petName: '',
    typeEmoji: '🐾',
    header: null,
    onThisDay: null,
    groups: [],
    hasData: false
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await api.ensureUser();
      const pet = await api.getPet();
      if (!pet) {
        this.setData({ loading: false, error: '还没有宠物，先去创建一个吧' });
        return;
      }
      const diary = petLife.getDiaryList();
      const letters = await api.listLetters();
      const tributes = tribute.list();
      const voices = voiceMemory.list();
      const now = Date.now();

      // 概览：第 N 天 + 互动统计（together.summary 内部聚合 moments）
      const summary = together.summary(pet, now);
      // 时间轴 + 往年今日（纯函数，时间注入同一个 now）
      const tl = memory.build({ pet, diary, letters, tributes, voices, now });
      const otd = memory.onThisDay({ pet, diary, letters, tributes, voices, now });

      this.setData({
        petName: pet.name || '它',
        typeEmoji: this.emojiOf(pet.type),
        header: {
          days: summary.days,
          startText: summary.startText,
          activeDays: summary.activeDays,
          streak: summary.streak,
          feed: summary.feed,
          play: summary.play,
          touch: summary.touch
        },
        onThisDay: otd,
        groups: tl.groups,
        hasData: tl.groups.length > 0,
        loading: false
      });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败，请重试' });
    }
  },

  emojiOf(type) {
    if (type === 'cat') return '🐱';
    if (type === 'dog') return '🐶';
    return '🐾';
  },

  goLetter() {
    wx.navigateTo({ url: '/pages/letter/letter' });
  },

  goTribute() {
    wx.navigateTo({ url: '/pages/tribute/tribute' });
  },

  loadRetry() {
    this.load();
  }
});
