const api = require('../../utils/api');
const privacy = require('../../utils/privacy');

const MAX_IMAGES = 3;

Page({
  data: {
    content: '',
    images: [],
    submitting: false,
    ownerName: '',
    showPrivacy: false
  },

  onLoad() {
    privacy.setShowHandler(() => this.setData({ showPrivacy: true }));
    // 发布者展示昵称取自宠物档案（仅展示用，服务端以 openid 鉴权）
    api.getPet().then((pet) => {
      if (pet) {
        this.setData({ ownerName: pet.ownerName || (pet.name + '的铲屎官') });
      }
    }).catch(() => {});
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

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  async addImage() {
    const remain = MAX_IMAGES - this.data.images.length;
    if (remain <= 0) return;
    const allowed = await privacy.ensure();
    if (!allowed) {
      wx.showToast({ title: '未同意隐私授权，暂时无法添加图片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newImages = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({ images: this.data.images.concat(newImages).slice(0, MAX_IMAGES) });
      }
    });
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    images.splice(idx, 1);
    this.setData({ images });
  },

  previewImage(e) {
    wx.previewImage({ urls: this.data.images, current: this.data.images[e.currentTarget.dataset.index] });
  },

  async submit() {
    if (this.data.submitting) return;
    const content = this.data.content.trim();
    if (!content && this.data.images.length === 0) {
      wx.showToast({ title: '写点什么，或加一张图片', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.publishPost({
        content,
        imagePaths: this.data.images,
        ownerName: this.data.ownerName
      });
      getApp().globalData.communityDirty = true;
      wx.showToast({ title: '发布成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (e) {
      this.setData({ submitting: false });
      wx.showModal({
        title: '发布失败',
        content: (e && e.message) || '网络异常，内容未发布，请重试',
        showCancel: false
      });
    }
  }
});
