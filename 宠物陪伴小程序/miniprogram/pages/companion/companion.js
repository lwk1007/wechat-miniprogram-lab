const api = require('../../utils/api');
const voice = require('../../utils/voice');
const moments = require('../../utils/moments');
const petLife = require('../../utils/pet-life');
const timeline = require('../../utils/timeline');
const titleOf = require('../../utils/title');
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
// 记住「这个场景是什么时候选的」：只存 id 的话，三天后回来还停在三天前那个时段
const SCENE_AT_KEY = 'pet_scene_at';

// 用户亲手选过场景，三小时内不自动带走（尊重当下的意愿）
const SCENE_IDLE_MS = 3 * 3600 * 1000;
// 存下的场景超过半天，认为已经过期，回正到当前时段
const SCENE_STALE_MS = 12 * 3600 * 1000;

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

// 自主活动的短特效（petLife 里给的是语义 key，具体表情在这里定，方便换）
const EFFECT_EMOJI = { zzz: '💤', sparkle: '✨', snack: '🍪', butterfly: '🦋', note: '🎵' };

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
    ownerTitle: titleOf.DEFAULT_TITLE,
    voiceOn: false,

    // 自主生命：心情徽章、活动特效、离线补记、足迹日记
    moodLabel: '开心',
    moodFace: '😊',
    effectEmoji: '',
    recap: [],
    diary: [],
    diaryOpen: false,

    // 场景
    scenes: SCENES,
    scene: 'grass',
    sceneName: '草地',
    // 此刻「本该在哪」：chip 上那个小圆点靠它，和 scene（实际在哪）分开
    nowScene: '',
    partId: '',
    // 天黑没：舞台按它切夜间配色，和「该去哪」是两个维度
    isNight: false,
    petX: 50,
    // petX 的像素版本：模板里横向位移走 transform，不再用 left 百分比
    xPx: 0,
    walkMs: 0,
    walking: false,
    facing: 'right',
    dragging: false,
    stars: [
      { key: 1, left: 10, top: 20, delay: 0, size: 'lg' },
      { key: 2, left: 22, top: 36, delay: 0.7, size: 'sm' },
      { key: 3, left: 34, top: 12, delay: 1.4, size: 'sm' },
      { key: 4, left: 46, top: 30, delay: 2.1, size: 'lg' },
      { key: 5, left: 58, top: 16, delay: 1.1, size: 'sm' },
      { key: 6, left: 70, top: 38, delay: 0.4, size: 'sm' },
      { key: 7, left: 82, top: 14, delay: 2.6, size: 'lg' },
      { key: 8, left: 92, top: 30, delay: 0.9, size: 'sm' },
      { key: 9, left: 16, top: 46, delay: 1.8, size: 'sm' },
      { key: 10, left: 40, top: 44, delay: 0.2, size: 'sm' },
      { key: 11, left: 64, top: 46, delay: 2.9, size: 'sm' },
      { key: 12, left: 88, top: 44, delay: 1.3, size: 'sm' }
    ]
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._winWidth = (info && info.windowWidth) || 375;

    const t = timeline.snapshot();
    const saved = wx.getStorageSync(SCENE_KEY);
    const savedAt = Number(wx.getStorageSync(SCENE_AT_KEY)) || 0;
    const valid = SCENES.some((s) => s.id === saved);
    // 存下的场景如果已经是半天前选的，时间早就不是那个时间了，回正
    const stale = valid && (!savedAt || Date.now() - savedAt > SCENE_STALE_MS);
    const id = valid && !stale ? saved : t.scene;

    this._lastUserSceneAt = stale ? 0 : savedAt;
    this.applyScene(id, false);
    this.setData({
      voiceOn: voice.enabled,
      isNight: t.isNight,
      nowScene: t.scene,
      partId: t.partId
    });
  },

  onShow() {
    // 先对齐时间：可能跨档，把场景带到该去的地方（只停走，重启交给下面的 startRoam）
    this.syncTime();
    this.loadPet().then(() => this.startRoam());
    this.scheduleSlot();
  },

  onHide() {
    this.stopRoam();
    this.clearSlotTimer();
    voice.stop();
    // 记下离开的时间点，回来时才算得出「你走了多久」
    try { petLife.markLeave(); } catch (e) { /* ignore */ }
  },

  onUnload() {
    this.stopRoam();
    this.clearSlotTimer();
    voice.destroy();
    try { petLife.markLeave(); } catch (e) { /* ignore */ }
    clearTimeout(this._animTimer);
    clearTimeout(this._heartTimer);
    clearTimeout(this._dropTimer);
    clearTimeout(this._faceTimer);
    clearTimeout(this._propTimer);
    clearTimeout(this._lifeTimer);
    clearTimeout(this._effectTimer);
  },

  // 对齐时钟：夜色、此刻该去哪、跨档后要不要把场景带过去
  syncTime() {
    const t = timeline.snapshot();
    const patch = {};
    if (t.isNight !== this.data.isNight) patch.isNight = t.isNight;
    if (t.scene !== this.data.nowScene) patch.nowScene = t.scene;
    const crossed = !!this.data.partId && this.data.partId !== t.partId;
    if (t.partId !== this.data.partId) patch.partId = t.partId;
    if (Object.keys(patch).length) this.setData(patch);

    if (!crossed) return;
    if (this.data.scene === t.scene) return; // 本来就在对的地方
    // 用户最近亲手选过，就先听他的
    if (Date.now() - (this._lastUserSceneAt || 0) < SCENE_IDLE_MS) return;

    this.stopRoam();
    // persist=false：自动切换不写 storage、也不记「带它去过」
    this.applyScene(t.scene, false);
    this.setData({ bubble: '', anim: '', expression: '' });
  },

  // 只排一次定时器，精确落到下一个分档点。不用 setInterval 每分钟空转
  scheduleSlot() {
    this.clearSlotTimer();
    const now = Date.now();
    const delay = Math.max(60000, timeline.nextBoundary(now) - now + 1500);
    this._slotTimer = setTimeout(() => {
      this._slotTimer = null;
      this.syncTime();
      this.scheduleSlot();
    }, delay);
  },

  clearSlotTimer() {
    if (this._slotTimer) {
      clearTimeout(this._slotTimer);
      this._slotTimer = null;
    }
  },

  applyScene(id, persist) {
    const meta = SCENES.filter((s) => s.id === id)[0] || SCENES[0];
    const t = timeline.snapshot();
    this.setData({
      scene: meta.id,
      sceneName: meta.name,
      // 换场景不改时刻，但顺手对齐一次，省得舞台和时钟错开
      isNight: t.isNight,
      nowScene: t.scene,
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
      wx.setStorageSync(SCENE_AT_KEY, Date.now());
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
    // 记下「你刚亲手换过」，两分钟内它不会自作主张再换走
    this._lastUserSceneAt = Date.now();
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
      // 去白底后的透明版：有就优先用，让主体直接站在场景里
      let petCut = (pet && pet.photoCut) || '';
      let petCutKind = (pet && pet.photoCutKind) || '';
      // 隐私模式照片过期：原图和它的透明版一起失效，回退为通用形象
      if (pet && pet.storageMode === 'private' && pet.photoExpiresAt && Date.now() > pet.photoExpiresAt) {
        photo = '';
        petCut = '';
        petCutKind = '';
      }
      if (!photo) {
        petCut = '';
        petCutKind = '';
      }
      // 它怎么称呼你：唯一出口在 utils/title.js —— 填过就用填的，没填就是「主人」
      const title = titleOf.resolve(pet);

      // 生命状态：只在这次进入页面算一次离线补记，
      // 否则从别的页面返回时时间差是 0，卡片会被反复清空又出现
      const patch = { recap: [], diary: [], moodLabel: '开心', moodFace: '😊' };
      if (pet) {
        const live = petLife.summary();
        patch.moodLabel = live.moodLabel;
        patch.moodFace = live.moodFace;
        patch.diary = petLife.decorateDiary(8);
        if (!this._recapDone) {
          this._recapDone = true;
          patch.recap = petLife.offlineRecap();
        }
      }

      this.setData(Object.assign({
        pet: pet || null,
        photo,
        petCut,
        petCutKind,
        isDemo: api.isDemo(),
        ownerTitle: title,
        typeEmoji: this.emojiOf(pet && pet.type),
        personalityLabel: pet ? PERSONALITY_LABEL[pet.personality] || '' : '',
        greeting: pet ? this.makeGreeting(pet) : '',
        status: pet ? this.petStatus(this.data.scene) : '',
        loading: false
      }, patch));
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
      // 停下休息：这段时间它自己做点事，而不是换个环境文案糊过去。
      // 不是每次休息都在「做事」——有时候就是单纯站着，否则状态和表情每三秒一跳，很假。
      const rest = 1600 + Math.random() * 2400;
      this._restTimer = setTimeout(() => {
        if (!this._roamAlive) return;
        if (Math.random() < 0.45) this.activityTick();
        this.walkOnce();
      }, rest);
    }, duration);
  },

  stopRoam() {
    this._roamAlive = false;
    clearTimeout(this._walkTimer);
    clearTimeout(this._restTimer);
    clearTimeout(this._sceneTimer);
    clearTimeout(this._lifeTimer);
    clearTimeout(this._effectTimer);
    this._walkTimer = null;
    this._restTimer = null;
    this._sceneTimer = null;
    this._lifeTimer = null;
    this._effectTimer = null;
    this._walk = null;
  },

  // 一次自主活动：改状态文案 / 表情 / 特效，写日记，必要时自己换个场景。
  // 它在休息期做这件事，所以不会和走动、拖动抢同一套动画。
  activityTick() {
    if (!this.data.pet || this.data.lifted || this._dragging) return;
    const pick = petLife.pickActivity(this.data.scene, this.data.pet.personality);
    const act = pick.activity;

    this.setData({
      status: act.emoji + ' ' + act.label,
      expression: act.face,
      effectEmoji: EFFECT_EMOJI[act.effect] || '',
      moodLabel: pick.mood.label,
      moodFace: pick.mood.face
    });

    // 打盹/啃零食冒个短气泡，其余只改状态文案，避免气泡一直挂着
    if (pick.bubble) {
      this.setData({ bubble: pick.bubble });
      clearTimeout(this._lifeTimer);
      this._lifeTimer = setTimeout(() => this.setData({ bubble: '' }), 2600);
    }

    clearTimeout(this._faceTimer);
    clearTimeout(this._effectTimer);
    this._faceTimer = setTimeout(() => this.setData({ expression: '' }), 3200);
    this._effectTimer = setTimeout(() => this.setData({ effectEmoji: '' }), 4200);

    if (pick.wroteDiary) this.setData({ diary: petLife.decorateDiary(8) });

    // 你两分钟没手动换场景，它可能自己溜达过去（有自己的主意，但不抢你的选择）
    if (Date.now() - (this._lastUserSceneAt || 0) > 120000 && Math.random() < 0.14) {
      const others = SCENES.filter((s) => s.id !== this.data.scene);
      const to = randomFrom(others);
      this.stopRoam();
      this.applyScene(to.id, false);
      petLife.writeRoamDiary(to);
      this.setData({ diary: petLife.decorateDiary(8), effectEmoji: '', expression: '' });
      this._sceneTimer = setTimeout(() => {
        this._sceneTimer = null;
        if (this.data.pet) this.startRoam();
      }, 320);
    }
  },

  toggleDiary() {
    this.setData({ diaryOpen: !this.data.diaryOpen });
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
    this.playReaction(type, this.reactionPool(type));
  },

  // #9：用户为某个场景写过的反应，直接用那句话；没写过就回到通用文案池。
  // 这样「自定义」不是摆设，喂食/摸摸时真的会说出你写的内容。
  reactionPool(type) {
    const pet = this.data.pet || {};
    const scenes = (pet.persona && pet.persona.scenes) || {};
    const text = String(scenes[type] || '').trim();
    if (text) return [text];
    return PHRASES[type] || PHRASES.touch;
  },

  playReaction(animType, pool) {
    const key = 'anim' + Date.now();
    const text = randomFrom(pool);
    const withProp = animType === 'feed' || animType === 'play';
    // 记一笔互动，给「一封信」当素材（catch 不在统计范围内，会被忽略）
    moments.bump(animType);

    // 你的动作会改变它的心情：喂食会开心、被拎会委屈。
    // 心情再反哺对话语气和下一个自主活动的选择，形成闭环。
    let moodPatch = null;
    if (animType !== 'catch') {
      try {
        const live = petLife.onInteraction(animType);
        const meta = petLife.moodMeta(live.mood);
        moodPatch = { moodLabel: meta.label, moodFace: meta.face };
      } catch (e) { /* 本机存储异常不影响互动 */ }
    }

    // 走到半路被叫停：位置先冻结到画面真值，否则零食/小球按 petX 的终点定位，
    // 会飞到宠物前面去（道具层用的是 left 百分比，没有过渡）
    const visualX = this.currentVisualX();
    this._walk = null;

    const patch = {
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
    };
    this.setData(Object.assign(patch, moodPatch || {}));
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

  // #9：被拎起来时它说的话
  liftLine() {
    const pet = this.data.pet || {};
    const scenes = (pet.persona && pet.persona.scenes) || {};
    const text = String(scenes.lift || '').trim();
    if (text) return text;
    return this.data.ownerTitle + '你怎么把我提起来了…';
  },

  // 长按 350ms 触发：被抓起来，脚离地
  onPetLongPress() {
    if (!this.data.pet || this.data.lifted) return;
    // 先记下画面上此刻的位置（可能正走在半路），再停掉走动
    const visualX = this.currentVisualX();
    this._dragging = true;
    this.stopRoam();
    moments.bump('lift');
    // 被拎起来会不高兴，这个心情会带到之后的对话里
    let moodPatch = null;
    try {
      const live = petLife.onInteraction('lift');
      const meta = petLife.moodMeta(live.mood);
      moodPatch = { moodLabel: meta.label, moodFace: meta.face };
    } catch (e) { /* ignore */ }
    const liftLine = this.liftLine();
    this.setData(Object.assign({
      lifted: true,
      walking: false,
      anim: '',
      // 位置换成画面上的真值、过渡归零：视觉上原地不动，但此后拖动完全跟手
      petX: visualX,
      xPx: this.pxOfX(visualX),
      walkMs: 0,
      liftY: -70,
      expression: '😾',
      bubble: liftLine,
      effectEmoji: ''
    }, moodPatch || {}));
    this.say(liftLine);
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

  goDesktop() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/desktop/desktop' });
  },

  goMemory() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/memory/memory' });
  },

  goMoodLog() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/mood-log/mood-log' });
  },

  goTribute() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/tribute/tribute' });
  },

  goTimeCapsule() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/time-capsule/time-capsule' });
  },

  goVoiceMemory() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/voice-memory/voice-memory' });
  },

  goLetter() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/letter/letter' });
  }
});
