const api = require('../../utils/api');
const cloudSvc = require('../../utils/cloud');
const privacy = require('../../utils/privacy');

const PERSONALITIES = [
  { key: 'loyal', label: '忠心' },
  { key: 'lively', label: '活泼' },
  { key: 'foodie', label: '贪吃' },
  { key: 'friendly', label: '亲人' }
];
const TYPES = [
  { key: 'cat', label: '猫' },
  { key: 'dog', label: '狗' },
  { key: 'other', label: '其他' }
];

Page({
  data: {
    loading: true,
    personalities: PERSONALITIES,
    types: TYPES,
    typeIndex: 2,
    photo: '',
    newPhoto: '',
    name: '',
    personality: '',
    ownerName: '',
    sinceDate: '',
    today: '',
    saving: false,
    showPrivacy: false
  },

  onLoad() {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    this.setData({ today });
    privacy.setShowHandler(() => this.setData({ showPrivacy: true }));
    this.load();
  },

  onUnload() {
    privacy.clearShowHandler();
  },

  onPrivacyAgree() {
    this.setData({ showPrivacy: false });
    privacy.approve();
  },

  onPrivacyCancel() {
    this.setData({ showPrivacy: false });
    privacy.reject();
  },

  async load() {
    try {
      const pet = await api.getPet();
      if (!pet) {
        wx.showModal({
          title: '还没有宠物档案',
          content: '先去创建一只吧',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }
      this.setData({
        loading: false,
        photo: pet.photo || '',
        name: pet.name,
        personality: pet.personality,
        ownerName: pet.ownerName || '',
        sinceDate: pet.sinceDate || '',
        typeIndex: Math.max(0, TYPES.findIndex((t) => t.key === pet.type))
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  async choosePhoto() {
    const allowed = await privacy.ensure();
    if (!allowed) {
      wx.showToast({ title: '未同意隐私授权，暂时无法选择照片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ newPhoto: res.tempFiles[0].tempFilePath });
      }
    });
  },
  preview() {
    const url = this.data.newPhoto || this.data.photo;
    if (url) wx.previewImage({ urls: [url] });
  },
  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onOwnerNameInput(e) { this.setData({ ownerName: e.detail.value }); },
  onTypeChange(e) { this.setData({ typeIndex: Number(e.detail.value) }); },
  onDateChange(e) { this.setData({ sinceDate: e.detail.value }); },
  choosePersonality(e) { this.setData({ personality: e.currentTarget.dataset.key }); },

  async save() {
    if (this.data.saving) return;
    if (!this.data.name.trim()) {
      wx.showToast({ title: '名字不能为空', icon: 'none' });
      return;
    }
    if (!this.data.personality) {
      wx.showToast({ title: '请选择性格', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const patch = {
        name: this.data.name,
        personality: this.data.personality,
        type: this.data.types[this.data.typeIndex].key,
        ownerName: this.data.ownerName,
        sinceDate: this.data.sinceDate
      };
      if (this.data.newPhoto) {
        if (api.isDemo()) {
          patch.photo = this.data.newPhoto;
        } else {
          const fileID = await cloudSvc.upload('pet/' + Date.now() + '.jpg', this.data.newPhoto);
          patch.newPhotoFileID = fileID;
        }
      }
      await api.updatePet(patch);
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      wx.showModal({ title: '保存失败', content: e.message || '请稍后重试', showCancel: false });
    } finally {
      this.setData({ saving: false });
    }
  }
});
