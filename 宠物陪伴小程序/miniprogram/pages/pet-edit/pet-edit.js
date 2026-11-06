const api = require('../../utils/api');
const cloudSvc = require('../../utils/cloud');
const privacy = require('../../utils/privacy');
const personaUtil = require('../../utils/persona');

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
