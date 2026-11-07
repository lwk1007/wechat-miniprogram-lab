const api = require('../../utils/api');
const privacy = require('../../utils/privacy');
const personaUtil = require('../../utils/persona');
const petLife = require('../../utils/pet-life');

const PERSONALITY_LABEL = { loyal: '忠心', lively: '活泼', foodie: '贪吃', friendly: '亲人' };

Page({
  data: {
    isDemo: true,
    pet: null,
    photo: '',
    typeEmoji: '🐾',
    personalityLabel: '',
    personaSummary: '',
    mode: 'private',
    savingMode: false,
    photoRemoving: false,
    purging: false,
    showRules: false,
    showHelp: false
  },

  onShow() {
    this.load();
  },

  onUnload() {
    privacy.clearShowHandler();
  },

  async load() {
    try {
      const pet = await api.getPet();
      let photo = (pet && pet.photo) || '';
      if (pet && pet.storageMode === 'private' && pet.photoExpiresAt && Date.now() > pet.photoExpiresAt) {
        photo = '';
      }
      this.setData({
        isDemo: api.isDemo(),
        pet,
        photo,
        mode: pet ? pet.storageMode : 'private',
        typeEmoji: pet && pet.type === 'cat' ? '🐱' : pet && pet.type === 'dog' ? '🐶' : '🐾',
        personalityLabel: pet ? PERSONALITY_LABEL[pet.personality] || '' : '',
        // #9：把自定义过的内容显示出来，否则用户填了也不知道有没有生效
        personaSummary: pet ? personaUtil.summary(pet) : ''
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  },

  goEdit() {
    wx.navigateTo({ url: '/pages/pet-edit/pet-edit' });
  },

  chooseMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (this.data.savingMode || mode === this.data.mode) return;
    this.setData({ mode });
  },

  async saveMode() {
    if (this.data.savingMode) return;
    const pet = this.data.pet;
    if (!pet || pet.storageMode === this.data.mode) return;
    this.setData({ savingMode: true });
    try {
      await api.updatePet({ storageMode: this.data.mode });
      wx.showToast({ title: '已切换', icon: 'success' });
      this.load();
    } catch (e) {
      wx.showToast({ title: e.message || '切换失败', icon: 'none' });
      this.setData({ mode: pet.storageMode });
    } finally {
      this.setData({ savingMode: false });
    }
  },

  deletePet() {
    wx.showModal({
      title: '删除宠物档案',
      content: '将删除宠物档案、照片素材和它写给你的信，且无法恢复。确定删除吗？',
      confirmColor: '#D97A6C',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.deletePet();
          // 心情和足迹日记存在本机，云端删宠物时清不到，这里补一刀，
          // 否则删了宠物再领养一只，它还记得上一只的心情
          try { petLife.reset(); } catch (e2) { /* ignore */ }
          wx.showToast({ title: '已删除', icon: 'success' });
          this.load();
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' });
        }
      }
    });
  },

  // ---------- 数据管理 ----------

  // 不等 22 小时自动过期，立即删掉照片
  removePhotoNow() {
    if (this.data.photoRemoving) return;
    wx.showModal({
      title: '立即删除照片',
      content: '删除后立刻改用通用形象，照片文件不再保留。互动数据不受影响。',
      confirmText: '删除照片',
      confirmColor: '#D97A6C',
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ photoRemoving: true });
        try {
          await api.removePhoto();
          wx.showToast({ title: '照片已删除', icon: 'success' });
          this.load();
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' });
        } finally {
          this.setData({ photoRemoving: false });
        }
      }
    });
  },

  // 清空全部数据：含社区里的动态、评论、点赞。两次确认，避免误触
  purgeAll() {
    if (this.data.purging) return;
    wx.showModal({
      title: '清空全部数据',
      content: '将删除宠物档案、照片和它写给你的信。这些内容都会从服务器移除，无法恢复。',
      confirmText: '继续',
      confirmColor: '#D97A6C',
      success: (r1) => {
        if (!r1.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '删除后无法恢复，也没有备份。确定要清空吗？',
          confirmText: '确定清空',
          confirmColor: '#D97A6C',
          success: async (r2) => {
            if (!r2.confirm) return;
            this.setData({ purging: true });
            try {
              const res = await api.purgeAll();
              try { petLife.reset(); } catch (e2) { /* ignore */ }
              const s = (res && res.summary) || {};
              wx.showModal({
                title: '已清空',
                content: '已删除：宠物 ' + (s.pets || 0) + ' 个、信 ' + (s.letters || 0) + ' 封。',
                showCancel: false
              });
              this.load();
            } catch (e) {
              wx.showToast({ title: e.message || '清空失败', icon: 'none' });
            } finally {
              this.setData({ purging: false });
            }
          }
        });
      }
    });
  },

  clearLocalCache() {
    wx.showModal({
      title: '清除本机缓存',
      content: '会清空这台设备上保存的内容（本机数据、场景偏好等）。云端数据不受影响。',
      confirmColor: '#D97A6C',
      success: (r) => {
        if (!r.confirm) return;
        try {
          wx.clearStorageSync();
          wx.showToast({ title: '已清除', icon: 'success' });
          setTimeout(() => wx.reLaunch({ url: '/pages/companion/companion' }), 800);
        } catch (e) {
          wx.showToast({ title: '清除失败', icon: 'none' });
        }
      }
    });
  },

  goExport() {
    wx.navigateTo({ url: '/pages/data-export/data-export' });
  },

  openPrivacyContract() {
    privacy.openContract();
  },

  toggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },
  toggleHelp() {
    this.setData({ showHelp: !this.data.showHelp });
  }
});
