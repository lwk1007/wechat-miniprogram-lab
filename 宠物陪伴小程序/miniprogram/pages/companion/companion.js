const api = require('../../utils/api');
const voice = require('../../utils/voice');
const moments = require('../../utils/moments');
const { randomFrom, greetingByHour } = require('../../utils/format');

const PERSONALITY_LABEL = { loyal: '忠心', lively: '活泼', foodie: '贪吃', friendly: '亲人' };

// 场景定义：全部用 WXSS 画，不依赖任何图片素材，包体零增长
const SCENES = [
  { id: 'grass', name: '草地', icon: '🌿' },
  { id: 'window', name: '窗台', icon: '🪟' },
  { id: 'living', name: '客厅', icon: '🛋️' },
  { id: 'seaside', name: '海边', icon: '🌊' },
  { id: 'night', name: '星空', icon: '🌙' }
];

// 场景里它正在干嘛（比原来那句通用的更有画面感）
const SCENE_STATUS = {
  grass: ['在草地上打滚 🌿', '追一只蝴蝶 🦋', '闻闻小花香不香 🌼'],
  window: ['趴在窗台晒太阳 ☀️', '看楼下的鸟飞过 🐦', '在窗边打盹 😴'],
  living: ['窝在沙发上发呆 🛋️', '把玩具推到沙发底下 🎾', '守着暖黄的灯光 💡'],
  seaside: ['在沙滩上追浪花 🌊', '被海风吹得眯眼睛 😌', '踩着自己的影子走 🐾'],
  night: ['数着星星打盹 🌙', '在月光下轻轻打呼 💤', '等一颗流星划过 ✨']
};

const SCENE_KEY = 'pet_scene';
const TITLE_KEY = 'pet_owner_title';

const PHRASES = {
  touch: ['呼噜噜…好舒服呀', '再摸摸嘛', '你的手好温暖'],
  feed: ['吧唧吧唧，好好吃！', '这个我最爱吃了！', '谢谢你投喂～'],
  play: ['来追我呀！', '接住小球！', '玩累了就一起晒太阳吧'],
  catch: ['被你抓到啦！', '嘿嘿，我在这里～', '哇，被发现了！']
};

// 每个动作配一张「表情」：不靠文字也能看出情绪
const REACTION_FACE = {
  touch: '😌',
  feed: '🤤',
  play: '😸',
  catch: '😆'
};

// 宠物走动的横向范围（百分比）：留出左右边距，气泡不会顶到屏幕边
const ROAM_MIN = 24;
const ROAM_MAX = 76;

Page({
  data: {
    loading: true,
    error: '',
    isDemo: true,
    pet: null,
    photo: '',
    typeEmoji: '🐾',
    personalityLabel: '',
    greeting: '',
    status: '',
    anim: '',
    hearts: [],
    bubble: '',

    // 互动表现
    expression: '',
    food: false,
    ball: false,
    lifted: false,
    liftY: 0,
    ownerTitle: '妈妈',
    voiceOn: false,

    // 场景
    scenes: SCENES,
    scene: 'grass',
    sceneName: '草地',
    petX: 50,
    // petX 的像素版本：模板里横向位移走 transform，不再用 left 百分比
    xPx: 0,
    walkMs: 0,
    walking: false,
    facing: 'right',
    dragging: false,
    stars: [
      { key: 1, left: 16, top: 18, delay: 0 },
      { key: 2, left: 32, top: 34, delay: 0.7 },
      { key: 3, left: 48, top: 14, delay: 1.4 },
      { key: 4, left: 62, top: 30, delay: 2.1 },
      { key: 5, left: 86, top: 20, delay: 1.1 }
    ]
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._winWidth = (info && info.windowWidth) || 375;

    const saved = wx.getStorageSync(SCENE_KEY);
    const id = SCENES.some((s) => s.id === saved) ? saved : this.defaultScene();
    this.applyScene(id, false);
    this.setData({ voiceOn: voice.enabled });
  },

  onShow() {
    this.loadPet().then(() => this.startRoam());
  },

  onHide() {
    this.stopRoam();
    voice.stop();
  },

  onUnload() {
    this.stopRoam();
    voice.destroy();
    clearTimeout(this._animTimer);
    clearTimeout(this._heartTimer);
    clearTimeout(this._dropTimer);
    clearTimeout(this._faceTimer);
    clearTimeout(this._propTimer);
  },

  // 默认场景跟着时间走：早上窗台、白天草地、傍晚海边、夜里星空
  defaultScene() {
    const h = new Date().getHours();
    if (h >= 5 && h < 9) return 'window';
    if (h >= 9 && h < 17) return 'grass';
    if (h >= 17 && h < 20) return 'seaside';
    return 'night';
  },

  applyScene(id, persist) {
    const meta = SCENES.filter((s) => s.id === id)[0] || SCENES[0];
    this.setData({
      scene: meta.id,
      sceneName: meta.name,
      walkMs: 0,
      petX: 50,
      xPx: this.pxOfX(50),
      walking: false,
      lifted: false,
      liftY: 0,
      status: this.petStatus(meta.id)
    });
    if (persist) {
      wx.setStorageSync(SCENE_KEY, meta.id);
      // 只记用户主动选的场景，自动切换不算「带它去过」
      moments.bumpScene(meta.id);
    }
  },

  petStatus(sceneId) {
    const pool = SCENE_STATUS[sceneId] || SCENE_STATUS.grass;
    return randomFrom(pool);
  },

  switchScene(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.scene) return;
    this.stopRoam();
    this.applyScene(id, true);
    this.setData({ bubble: '', anim: '', expression: '' });
    // 换场景后重新开始溜达，稍等一下让位置先归位
    this._sceneTimer = setTimeout(() => {
      this._sceneTimer = null;
      if (this.data.pet) this.startRoam();
    }, 320);
  },

  async loadPet() {
    this.setData({ loading: true, error: '' });
    try {
      await api.ensureUser();
      const pet = await api.getPet();
      let photo = (pet && pet.photo) || '';
      // 隐私模式照片过期：回退为通用形象
      if (pet && pet.storageMode === 'private' && pet.photoExpiresAt && Date.now() > pet.photoExpiresAt) {
        photo = '';
      }
      // 它怎么称呼你：宠物身上有就用宠物的，否则用本机记住的，再否则「妈妈」
      const title = (pet && pet.ownerTitle) || wx.getStorageSync(TITLE_KEY) || '妈妈';
      this.setData({
        pet: pet || null,
        photo,
        isDemo: api.isDemo(),
        ownerTitle: title,
        typeEmoji: this.emojiOf(pet && pet.type),
        personalityLabel: pet ? PERSONALITY_LABEL[pet.personality] || '' : '',
        greeting: pet ? this.makeGreeting(pet) : '',
        status: pet ? this.petStatus(this.data.scene) : '',
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

  makeGreeting(pet) {
    const base = greetingByHour();
    const sound = pet.type === 'cat' ? '喵～' : pet.type === 'dog' ? '汪！' : '';
    return sound + base;
  },

  /* ---------------- 场景内自主活动 ---------------- */

  startRoam() {
    // 先清掉可能在排队的「换场景后启动」，避免两套循环叠在一起
    this.stopRoam();
    this._roamAlive = true;
    // 进场景先站一会儿，别一上来就走
    this._restTimer = setTimeout(() => this.walkOnce(), 1400);
  },

  walkOnce() {
    if (!this._roamAlive) return;
    const from = this.data.petX;
    let to = ROAM_MIN + Math.random() * (ROAM_MAX - ROAM_MIN);
    // 目标太近就重新选，避免原地抖
    if (Math.abs(to - from) < 14) {
      to = to > 50 ? ROAM_MIN + Math.random() * 10 : ROAM_MAX - Math.random() * 10;
    }
    const distance = Math.abs(to - from);
    const duration = Math.round(Math.max(1100, Math.min(4200, distance * 92)));
    const targetX = Math.round(to * 10) / 10;

    this.setData({
      petX: targetX,
      xPx: this.pxOfX(targetX),
      walkMs: duration,
      walking: true,
      facing: to >= from ? 'right' : 'left'
    });
    // 记住这段走动的起止，长按提起时用来算「此刻画面上实际在哪」
    this._walk = { from, to, start: Date.now(), duration };

    this._walkTimer = setTimeout(() => {
      if (!this._roamAlive) return;
      this._walk = null;
      this.setData({ walking: false });
      // 停下休息，偶尔自己换个心情文案
      const rest = 1600 + Math.random() * 2400;
      this._restTimer = setTimeout(() => {
        if (!this._roamAlive) return;
        if (Math.random() < 0.4) {
          this.setData({ status: this.petStatus(this.data.scene) });
        }
        this.walkOnce();
      }, rest);
    }, duration);
  },

  stopRoam() {
    this._roamAlive = false;
    clearTimeout(this._walkTimer);
    clearTimeout(this._restTimer);
    clearTimeout(this._sceneTimer);
    this._walkTimer = null;
    this._restTimer = null;
    this._sceneTimer = null;
    this._walk = null;
  },

  // 百分比 → 逻辑像素。横向位置统一用 transform 驱动（合成层，无 layout），
  // petX 仍然保留百分比语义给走动范围和边界钳制用。
  // 取整到 1px：合成层上的亚像素位移会让图片和气泡文字发虚
  pxOfX(p) {
    const w = this._winWidth || 375;
    return Math.round((p * w) / 100);
  },

  // 走动是 CSS transition 在跑，petX 已经是终点值；
  // 这里按时间线性插值算出「此刻画面上真正停在哪」，提起时用它当基准
  currentVisualX() {
    const w = this._walk;
    if (!w || !w.duration) return this.data.petX;
    const p = Math.min(1, Math.max(0, (Date.now() - w.start) / w.duration));
    return Math.round((w.from + (w.to - w.from) * p) * 10) / 10;
  },

  /* ---------------- 互动 ---------------- */

  // 免费体验：一键创建默认宠物，无需注册
  async quickStart() {
    this.setData({ creating: true });
    try {
      await api.createPet({
        name: '小毛球',
        personality: 'friendly',
        type: 'other',
        storageMode: 'private',
        photo: ''
      });
      this.loadPet();
    } catch (e) {
      wx.showToast({ title: e.message || '创建失败', icon: 'none' });
    } finally {
      this.setData({ creating: false });
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  },

  async loadRetry() {
    this.loadPet();
  },

  // 点一下：调皮反应
  tapPet() {
    if (!this.data.pet) return;
    if (this.data.lifted || this._dragging) return;
    if (Date.now() - (this._justDropped || 0) < 500) return;
    this.playReaction('catch', PHRASES.catch);
  },

  // 底部四个动作
  interact(e) {
    if (!this.data.pet) return;
    if (this.data.lifted) return;
    const type = e.currentTarget.dataset.type || 'touch';
    this.playReaction(type, PHRASES[type] || PHRASES.touch);
  },

  playReaction(animType, pool) {
    const key = 'anim' + Date.now();
    const text = randomFrom(pool);
    const withProp = animType === 'feed' || animType === 'play';
    // 记一笔互动，给「一封信」当素材（catch 不在统计范围内，会被忽略）
    moments.bump(animType);

    // 走到半路被叫停：位置先冻结到画面真值，否则零食/小球按 petX 的终点定位，
    // 会飞到宠物前面去（道具层用的是 left 百分比，没有过渡）
    const visualX = this.currentVisualX();
    this._walk = null;

    this.setData({
      anim: 'anim-' + animType,
      bubble: text,
      expression: REACTION_FACE[animType] || '',
      food: animType === 'feed',
      ball: animType === 'play',
      petX: visualX,
      xPx: this.pxOfX(visualX),
      walkMs: 0,
      walking: false,
      ['hearts[' + this.data.hearts.length + ']']: { key, left: 20 + Math.random() * 60 }
    });
    this.say(text);

    clearTimeout(this._animTimer);
    clearTimeout(this._heartTimer);
    clearTimeout(this._faceTimer);
    clearTimeout(this._propTimer);
    // 吃东西要嚼久一点，其他动作 1.1s 收
    this._animTimer = setTimeout(() => this.setData({ anim: '' }), animType === 'feed' ? 1500 : 1100);
    this._heartTimer = setTimeout(() => this.setData({ hearts: [] }), 1400);
    this._faceTimer = setTimeout(() => this.setData({ expression: '' }), 1500);
    if (withProp) {
      this._propTimer = setTimeout(() => this.setData({ food: false, ball: false }), 1400);
    }
  },

  /* ---------------- 提溜 / 揪起 ---------------- */

  onPetTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._dragFrom = {
      x: t.clientX,
      y: t.clientY,
      petX: this.data.petX,
      liftY: this.data.liftY
    };
    // 拖动方向判断的基准，长按后重新计
    this._lastDragX = null;
  },

  // 长按 350ms 触发：被抓起来，脚离地
  onPetLongPress() {
    if (!this.data.pet || this.data.lifted) return;
    // 先记下画面上此刻的位置（可能正走在半路），再停掉走动
    const visualX = this.currentVisualX();
    this._dragging = true;
    this.stopRoam();
    moments.bump('lift');
    this.setData({
      lifted: true,
      walking: false,
      anim: '',
      // 位置换成画面上的真值、过渡归零：视觉上原地不动，但此后拖动完全跟手
      petX: visualX,
      xPx: this.pxOfX(visualX),
      walkMs: 0,
      liftY: -70,
      expression: '😾',
      bubble: this.data.ownerTitle + '你怎么把我提起来了…'
    });
    this.say(this.data.ownerTitle + '你怎么把我提起来了');
    // 抓起时基准高度变了（离地 70px），基准位置也换成冻结后的真值，
    // 否则手指一动，宠物会先掉回地面 / 跳到走动终点再被拉起来
    if (this._dragFrom) {
      this._dragFrom.liftY = -70;
      this._dragFrom.petX = visualX;
    }
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 部分机型不支持 */ }
    }
  },

  // 提着的时候跟着手指走
  onPetTouchMove(e) {
    if (!this._dragging || !this._dragFrom) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = (t.clientX - this._dragFrom.x) / (this._winWidth || 375) * 100;
    const dy = t.clientY - this._dragFrom.y;
    const x = Math.round(Math.max(12, Math.min(88, this._dragFrom.petX + dx)) * 10) / 10;
    // 只允许往上提，最多离地 180px，松手前不会飞出屏幕
    const y = Math.round(Math.max(-180, Math.min(0, this._dragFrom.liftY + dy)));

    // 拖动中一直保持 dragging=true（关掉 left / transform 的过渡），
    // 否则走动的 transition-duration 会让宠物一路追着手指跑，越拖越远
    const isDragging = this.data.dragging;
    if (isDragging && x === this.data.petX && y === this.data.liftY) return;

    const next = { dragging: true, petX: x, xPx: this.pxOfX(x), liftY: y };

    // 朝拖动方向转身：横向拖出一点才翻，避免原地小幅抖动来回翻
    const last = this._lastDragX == null ? this._dragFrom.petX : this._lastDragX;
    if (Math.abs(x - last) >= 0.8) {
      const face = x > last ? 'right' : 'left';
      if (face !== this.data.facing) next.facing = face;
      this._lastDragX = x;
    }

    this.setData(next);
  },

  onPetTouchEnd() {
    if (!this._dragging) return;
    this._dragging = false;
    this.dropPet();
  },

  // 松手：落地、压扁回弹、被吓一跳
  dropPet() {
    this._justDropped = Date.now();
    this.setData({
      lifted: false,
      dragging: false,
      // 位置不再由走动驱动，过渡归零，落地只走 lift 层的回弹
      walkMs: 0,
      liftY: 0,
      anim: 'anim-land',
      expression: '😵',
      bubble: '呼…吓我一跳'
    });
    this.say('呼，吓我一跳');
    clearTimeout(this._dropTimer);
    this._dropTimer = setTimeout(() => {
      this.setData({ anim: '', expression: '' });
      if (this.data.pet) this.startRoam();
    }, 950);
  },

  /* ---------------- 声音 ---------------- */

  // 没开语音时这里静默返回，气泡文字照常显示
  say(text) {
    voice.speak(text).catch(() => {});
  },

  goChat() {
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  goDesktop() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/desktop/desktop' });
  },

  goLetter() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/letter/letter' });
  }
});
