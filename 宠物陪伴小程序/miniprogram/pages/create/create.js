const api = require('../../utils/api');
const cloudSvc = require('../../utils/cloud');
const privacy = require('../../utils/privacy');
const cutout = require('../../utils/cutout');
const titleOf = require('../../utils/title');

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
    // 去白底：选完图当场算一次，算完立刻给用户看对比，让他自己决定用哪张
    photoCut: '',
    photoCutKind: '',
    useCut: false,
    // 非白底（本地去不干净）时置真：提交时走云端语义抠图
    needCloudCut: false,
    photoCutting: false,
    cutHint: '',
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
    // 页面没了还在算：把 token 作废，免得回调往一个已销毁的页面上 setData
    this._cutToken = (this._cutToken || 0) + 1;
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

  // 第一步：照片（必填）。选完立刻在本地试一次去白底，几毫秒，不上传
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
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({ photo: f.tempFilePath });
        this.startCut(f.tempFilePath);
      }
    });
  },

  // 失败是常态不是异常：宠物蹲在沙发上、背景是花纹地毯，这类图本来就不该动。
  // 所以这里不弹 toast、不挡流程，只在照片底下留一行说明，让它按原图走。
  startCut(src) {
    // 用户连选两次时，先算完的那张不能覆盖后选的
    const token = (this._cutToken || 0) + 1;
    this._cutToken = token;
    this.setData({ photoCutting: true, photoCut: '', photoCutKind: '', useCut: false, needCloudCut: false, cutHint: '' });
    const task = cutout.cut(src).then((res) => {
      if (token !== this._cutToken) return;
      this.setData({
        photoCutting: false,
        photoCut: res.path,
        photoCutKind: res.kind,
        useCut: true,
        needCloudCut: false,
        cutHint: cutout.describe(res)
      });
    }).catch((err) => {
      if (token !== this._cutToken) return;
      // 背景不是纯白 = 本地去不干净。云模式下转交云端语义抠图，演示模式按原图用
      const needCloud = err && err.code === 'not-white' && !api.isDemo();
      this.setData({
        photoCutting: false,
        needCloudCut: needCloud,
        cutHint: needCloud ? '背景较复杂，提交时会自动智能抠图' : this.explainCut(err)
      });
    });
    this._cutTask = task;
    return task;
  },

  explainCut(err) {
    const code = err && err.code;
    if (code === 'unsupported') return '这个环境不支持本地处理，按原图用';
    if (code === 'not-white') return '这张背景里有东西，先按原图用';
    if (code === 'all-white') return '这张几乎是纯白，没找到主体，按原图用';
    if (code === 'no-line') return '这张没找到线条，按原图用';
    return '这张没能自动处理，按原图用';
  },

  // 让用户自己看两张的差别再决定 —— 处理得对不对，他比算法清楚
  toggleCut() {
    if (!this.data.photoCut) return;
    this.setData({ useCut: !this.data.useCut });
  },

  previewPhoto() {
    const url = this.data.useCut && this.data.photoCut ? this.data.photoCut : this.data.photo;
    wx.previewImage({ urls: [url] });
  },
  removePhoto() {
    this._cutToken = (this._cutToken || 0) + 1;
    this._cutTask = null;
    this.setData({ photo: '', photoCut: '', photoCutKind: '', useCut: false, photoCutting: false, cutHint: '' });
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
    // 上一张图还在算的时候点了提交：等它算完，否则会存成「有原图、没透明版」
    if (this._cutTask) await this._cutTask;
    const base = {
      name: this.data.name,
      personality: this.data.personality,
      type: this.data.types[this.data.typeIndex].key,
      ownerName: titleOf.normalize(this.data.ownerName),
      sinceDate: this.data.sinceDate,
      storageMode: this.data.mode
    };
    const cut = this.data.useCut && this.data.photoCut ? this.data.photoCut : '';
    const cutKind = cut ? this.data.photoCutKind : '';
    this.setData({ submitting: true, submitText: '正在上传照片…' });
    try {
      if (api.isDemo()) {
        await new Promise((r) => setTimeout(r, 600));
        await api.createPet(Object.assign({}, base, {
          photo: this.data.photo,
          photoCut: cut,
          photoCutKind: cutKind
        }));
      } else {
        const fileID = await cloudSvc.upload('pet/' + Date.now() + '.jpg', this.data.photo);
        let cutFileID = '';
        if (cut) {
          this.setData({ submitText: '正在上传形象…' });
          cutFileID = await cloudSvc.upload('pet/' + Date.now() + '-cut.png', cut);
        } else if (this.data.needCloudCut) {
          // 本地去白底没吃掉的复杂背景，交云函数语义抠图；失败降级用原图，不挡创建
          this.setData({ submitText: '正在智能抠图…' });
          try {
            const r = await api.cutoutPhoto(fileID);
            cutFileID = (r && r.fileID) || '';
          } catch (e) {
            cutFileID = '';
          }
        }
        this.setData({ submitText: '正在创建档案…' });
        await api.createPet(Object.assign({}, base, { photoFileID: fileID, photoCutFileID: cutFileID }));
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
