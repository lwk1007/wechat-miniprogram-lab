const api = require('../../utils/api');
const cloudSvc = require('../../utils/cloud');
const privacy = require('../../utils/privacy');
const personaUtil = require('../../utils/persona');
const cutout = require('../../utils/cutout');
const titleOf = require('../../utils/title');

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
    // 换图时同样当场试一次去白底，处理结果存在这儿，保存时一起提交
    newPhotoCut: '',
    newPhotoCutKind: '',
    useCut: false,
    // 非白底（本地去不干净）时置真：保存时走云端语义抠图
    needCloudCut: false,
    photoCutting: false,
    cutHint: '',
    name: '',
    personality: '',
    ownerName: '',
    sinceDate: '',
    today: '',
    saving: false,
    showPrivacy: false,
    // #9 性格自定义：折叠区默认收起，已有自定义内容时自动展开
    persona: personaUtil.emptyPersona(),
    traitOptions: personaUtil.TRAIT_OPTIONS.map((name) => ({ name, on: false })),
    sceneList: personaUtil.SCENES.map((key) => ({
      key,
      label: personaUtil.SCENE_LABEL[key],
      placeholder: personaUtil.SCENE_PLACEHOLDER[key]
    })),
    personaOpen: false,
    personaPreview: ''
  },

  onLoad() {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    this.setData({ today });
    privacy.setShowHandler(() => this.setData({ showPrivacy: true }));
    this.load();
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
      const saved = pet.persona || {};
      const savedTraits = Array.isArray(saved.traits) ? saved.traits : [];
      const savedScenes = saved.scenes || {};
      const hasCustom = !!(savedTraits.length || saved.speech || saved.catchphrase || saved.quirk || Object.keys(savedScenes).length);

      this.setData({
        loading: false,
        photo: pet.photo || '',
        name: pet.name,
        personality: pet.personality,
        ownerName: pet.ownerName || '',
        sinceDate: pet.sinceDate || '',
        typeIndex: Math.max(0, TYPES.findIndex((t) => t.key === pet.type)),
        persona: {
          traits: savedTraits.slice(),
          speech: saved.speech || '',
          catchphrase: saved.catchphrase || '',
          quirk: saved.quirk || '',
          scenes: Object.assign({}, personaUtil.emptyPersona().scenes, savedScenes)
        },
        traitOptions: personaUtil.TRAIT_OPTIONS.map((name) => ({ name, on: savedTraits.indexOf(name) >= 0 })),
        personaOpen: hasCustom
      });
      this.refreshPreview();
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
        const f = res.tempFiles && res.tempFiles[0];
        if (!f) return;
        this.setData({ newPhoto: f.tempFilePath });
        this.startCut(f.tempFilePath);
      }
    });
  },

  // 和创建页同一套：失败不弹窗、不挡保存，只在照片下面留一行说明
  startCut(src) {
    const token = (this._cutToken || 0) + 1;
    this._cutToken = token;
    this.setData({ photoCutting: true, newPhotoCut: '', newPhotoCutKind: '', useCut: false, needCloudCut: false, cutHint: '' });
    const task = cutout.cut(src).then((res) => {
      if (token !== this._cutToken) return;
      this.setData({
        photoCutting: false,
        newPhotoCut: res.path,
        newPhotoCutKind: res.kind,
        useCut: true,
        needCloudCut: false,
        cutHint: cutout.describe(res)
      });
    }).catch((err) => {
      if (token !== this._cutToken) return;
      const needCloud = err && err.code === 'not-white' && !api.isDemo();
      this.setData({
        photoCutting: false,
        needCloudCut: needCloud,
        cutHint: needCloud ? '背景较复杂，保存时会自动智能抠图' : this.explainCut(err)
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

  toggleCut() {
    if (!this.data.newPhotoCut) return;
    this.setData({ useCut: !this.data.useCut });
  },

  preview() {
    const url = this.data.newPhoto || this.data.photo;
    if (url) wx.previewImage({ urls: [url] });
  },
  onNameInput(e) { this.setData({ name: e.detail.value }); },
  onOwnerNameInput(e) { this.setData({ ownerName: e.detail.value }); },
  onTypeChange(e) { this.setData({ typeIndex: Number(e.detail.value) }); },
  onDateChange(e) { this.setData({ sinceDate: e.detail.value }); },
  choosePersonality(e) {
    this.setData({ personality: e.currentTarget.dataset.key });
    // 换底色后，没自定义过的场景文案要跟着变
    this.refreshPreview();
  },

  togglePersona() {
    this.setData({ personaOpen: !this.data.personaOpen });
  },

  // 特质最多 3 个：再多模型也抓不住重点，反而互相打架
  toggleTrait(e) {
    const name = e.currentTarget.dataset.name;
    const next = this.data.traitOptions.map((t) => ({
      name: t.name,
      on: t.name === name ? !t.on : t.on
    }));
    const picked = next.filter((t) => t.on);
    if (picked.length > 3) {
      wx.showToast({ title: '最多选 3 个', icon: 'none' });
      return;
    }
    this.setData({
      traitOptions: next,
      'persona.traits': picked.map((t) => t.name)
    });
  },

  onPersonaInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['persona.' + field]: e.detail.value });
  },

  onSceneInput(e) {
    const scene = e.currentTarget.dataset.scene;
    this.setData({ ['persona.scenes.' + scene]: e.detail.value });
    if (scene === 'touch') this.refreshPreview();
  },

  // 实时预览：让用户立刻看到「填的东西真的会变成它的反应」
  refreshPreview() {
    const line = personaUtil.normalize({
      personality: this.data.personality,
      persona: this.data.persona
    }).scenes.touch;
    this.setData({ personaPreview: line });
  },

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
        persona: personaUtil.sanitize(this.data.persona),
        type: this.data.types[this.data.typeIndex].key,
        ownerName: titleOf.normalize(this.data.ownerName),
        sinceDate: this.data.sinceDate
      };
      if (this.data.newPhoto) {
        // 换的图还在算的时候点了保存：等它算完，否则新图会顶着上一张的轮廓
        if (this._cutTask) await this._cutTask;
        const cut = this.data.useCut && this.data.newPhotoCut ? this.data.newPhotoCut : '';
        if (api.isDemo()) {
          patch.photo = this.data.newPhoto;
          // 显式传空串：localdb 靠「photo 变了但没带 photoCut」来清掉旧抠图，
          // 这里把意图写明白，别依赖隐式分支
          patch.photoCut = cut;
          patch.photoCutKind = cut ? this.data.newPhotoCutKind : '';
        } else {
          const fileID = await cloudSvc.upload('pet/' + Date.now() + '.jpg', this.data.newPhoto);
          patch.newPhotoFileID = fileID;
          if (cut) {
            patch.newPhotoCutFileID = await cloudSvc.upload('pet/' + Date.now() + '-cut.png', cut);
          } else if (this.data.needCloudCut) {
            try {
              const r = await api.cutoutPhoto(fileID);
              patch.newPhotoCutFileID = (r && r.fileID) || '';
            } catch (e) {
              patch.newPhotoCutFileID = '';
            }
          }
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
