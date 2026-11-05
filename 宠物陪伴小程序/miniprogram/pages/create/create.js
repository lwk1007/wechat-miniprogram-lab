const api = require('../../utils/api');
const cloudSvc = require('../../utils/cloud');
const privacy = require('../../utils/privacy');

const PERSONALITIES = [
  { key: 'loyal', label: '忠心', desc: '一直守在你身边' },
  { key: 'lively', label: '活泼', desc: '蹦蹦跳跳停不下来' },
  { key: 'foodie', label: '贪吃', desc: '看到吃的就走不动' },
  { key: 'friendly', label: '亲人', desc: '温柔又粘人' }
];
const TYPES = [
  { key: 'cat', label: '猫' },
  { key: 'dog', label: '狗' },
  { key: 'other', label: '其他' }
];

Page({
  data: {
    step: 1,
    personalities: PERSONALITIES,
    types: TYPES,
    typeIndex: 2,
    photo: '',
    name: '',
    personality: '',
    ownerName: '',
    sinceDate: '',
    today: '',
    mode: 'private',
    submitting: false,
    showPrivacy: false,
    submitText: '创建宠物'
  },

  onLoad() {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    this.setData({ today });
    // 隐私接口被拦截时由本页底部弹窗承接授权
    privacy.setShowHandler(() => this.setData({ showPrivacy: true }));
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

  // 第一步：照片（必填）
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
        this.setData({ photo: res.tempFiles[0].tempFilePath });
      }
    });
  },
  previewPhoto() {
    wx.previewImage({ urls: [this.data.photo] });
  },
  removePhoto() {
    this.setData({ photo: '' });
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },
  onOwnerNameInput(e) {
    this.setData({ ownerName: e.detail.value });
  },
  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },
  onDateChange(e) {
    this.setData({ sinceDate: e.detail.value });
  },
  choosePersonality(e) {
    this.setData({ personality: e.currentTarget.dataset.key });
  },
  chooseMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  next() {
    if (this.data.step === 1) {
      if (!this.data.photo) {
        wx.showToast({ title: '请先选一张照片', icon: 'none' });
        return;
      }
      this.setData({ step: 2 });
    } else if (this.data.step === 2) {
      if (!this.data.name.trim()) {
        wx.showToast({ title: '给它起个名字吧', icon: 'none' });
        return;
      }
      if (!this.data.personality) {
        wx.showToast({ title: '选一个它的性格', icon: 'none' });
        return;
      }
      this.setData({ step: 3 });
    }
  },
  prev() {
    if (this.data.step > 1) this.setData({ step: this.data.step - 1 });
  },

  // 第三步：提交。云模式先上传照片再建档，失败可重试且不会重复建档
  async submit() {
    if (this.data.submitting) return;
    if (!this.data.name.trim()) return;
    const base = {
      name: this.data.name,
      personality: this.data.personality,
      type: this.data.types[this.data.typeIndex].key,
      ownerName: this.data.ownerName,
      sinceDate: this.data.sinceDate,
      storageMode: this.data.mode
    };
    this.setData({ submitting: true, submitText: '正在上传照片…' });
    try {
      if (api.isDemo()) {
        await new Promise((r) => setTimeout(r, 600));
        await api.createPet(Object.assign({}, base, { photo: this.data.photo }));
      } else {
        const fileID = await cloudSvc.upload('pet/' + Date.now() + '.jpg', this.data.photo);
        this.setData({ submitText: '正在创建档案…' });
        await api.createPet(Object.assign({}, base, { photoFileID: fileID }));
      }
      wx.showToast({ title: '创建成功', icon: 'success' });
      setTimeout(() => wx.reLaunch({ url: '/pages/companion/companion' }), 800);
    } catch (e) {
      this.setData({ submitting: false, submitText: '重新尝试创建' });
      wx.showModal({
        title: '创建失败',
        content: (e && e.message) || '网络异常，照片未保存，请重试',
        showCancel: false
      });
    }
  }
});
