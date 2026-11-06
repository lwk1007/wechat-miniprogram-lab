const api = require('../../utils/api');
const moments = require('../../utils/moments');
const petLife = require('../../utils/pet-life');
const timeline = require('../../utils/timeline');
const { randomFrom } = require('../../utils/format');

const TOUCH_PHRASES = ['呼噜噜…', '别戳啦，痒～', '你终于来看我了', '我一直在等你哦'];
const FEED_PHRASES = ['咔嚓咔嚓，好吃！', '还有吗还有吗', '这是我今天最开心的事'];
const PLAY_PHRASES = ['追我呀追我呀', '接住这个小球！', '再玩一会儿嘛'];
const CHAT_PHRASES = ['我们去说说话吧', '有好多话想跟你说'];
const COME_PHRASES = ['我来啦！', '这就到～', '叫我干嘛呀'];
const LIFT_PHRASES = ['你怎么把我提起来了…', '欸欸，我恐高！', '放我下来啦'];
const DROP_PHRASES = ['呼…吓我一跳', '安全着陆！', '下次轻点儿…'];

// 动作 → 表情 / 动画（动画类名 wxss 里已有，表情是新加的一层）
const ACTION_FACE = { touch: '😌', feed: '🤤', play: '😸' };
const ACTION_ANIM = { touch: 'anim-happy', feed: 'anim-eat', play: 'anim-bounce' };

// col：图标所在列（0~3），宠物走过该列下方时这一列会抖一下
const DESK_APPS = [
  { name: '相册', emoji: '🖼️', bg: '#F2F5F8', col: 0 },
  { name: '天气', emoji: '⛅', bg: '#EAF1FA', col: 1 },
  { name: '音乐', emoji: '🎵', bg: '#FBEDEF', col: 2 },
  { name: '备忘', emoji: '📝', bg: '#FDF6E9', col: 3 },
  { name: '日历', emoji: '📅', bg: '#EFF6EE', col: 0 },
  { name: '时钟', emoji: '⏰', bg: '#F3F0FA', col: 1 },
  { name: '相机', emoji: '📷', bg: '#F0F1F3', col: 2 },
  { name: '设置', emoji: '⚙️', bg: '#EEF2F0', col: 3 }
];

// 四列图标的中心位置（占屏宽百分比）：外层 padding 40rpx，四列各占 1/4
const ICON_COLUMNS = [16.5, 38.8, 61.2, 83.5];

Page({
  data: {
    statusBarHeight: 20,
    navPadRight: 108,
    clock: '',
    loading: true,
    error: '',
    isDemo: true,
    apps: DESK_APPS,

    pet: null,
    photo: '',
    typeEmoji: '🐾',

    // 宠物在桌面上的位置与姿态
    petX: 50,
    // petX 的像素版：横向位移走 transform 合成层，不用 left 布局
    xPx: 0,
    duration: 0,
    facing: 1,
    walking: false,
    running: false,

    // 提溜
    lifted: false,
    liftY: 0,
    dragging: false,
    expression: '',
    food: false,
    ball: false,

    anim: '',
    bubble: '',
    bubbleX: 50,
    bubblePx: 0,
    hearts: [],
    shakeCol: -1,
    night: false,
    showGuide: true,
    // 心情跟着陪伴页的互动走，桌面这层只负责显示
    moodLabel: '',
    moodFace: ''
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._winWidth = (info && info.windowWidth) || 375;
    // 自绘导航要给右上角胶囊让位，否则信号/电池会被它压住
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const navPadRight = menu && menu.left
      ? Math.round(this._winWidth - menu.left + 12)
      : 108;
    this.setData({
      statusBarHeight: (info && info.statusBarHeight) || 20,
      navPadRight,
      clock: this.nowClock(),
      night: this.isNight(),
      xPx: this.pxOfX(this.data.petX),
      bubblePx: this.pxOfX(this.data.bubbleX)
    });
    this.loadPet();
    this.tickClock();
    this._clockTimer = setInterval(() => this.tickClock(), 10000);
    // 引导条 6 秒后自动收起
    this._guideTimer = setTimeout(() => this.setData({ showGuide: false }), 6000);
  },

  onShow() {
    // 心情可能被上一页的互动改过，回来时同步一次
    this.syncMood();
    // 回到本页时继续走动（onHide 时已停止）
    if (!this.data.loading && this.data.pet && !this.data.lifted) this.startRoaming();
  },

  syncMood() {
    try {
      const m = petLife.summary();
      this.setData({ moodLabel: m.moodLabel, moodFace: m.moodFace });
    } catch (e) { /* 本机状态读不到时保持上一次显示 */ }
  },

  onHide() {
    this.stopRoaming();
  },

  onUnload() {
    this.stopRoaming();
    clearInterval(this._clockTimer);
    clearTimeout(this._guideTimer);
    clearTimeout(this._animTimer);
    clearTimeout(this._bubbleTimer);
    clearTimeout(this._heartTimer);
    clearTimeout(this._deskTapTimer);
    clearTimeout(this._dropTimer);
    clearTimeout(this._faceTimer);
    clearTimeout(this._propTimer);
  },

  // 百分比 → 逻辑像素。取整到 1px：合成层上的亚像素位移会让照片和气泡发虚
  pxOfX(p) {
    return Math.round((p * (this._winWidth || 375)) / 100);
  },

  nowClock() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  // 夜里 = 19:00 之后，或 6:00 之前。边界在 utils/timeline.js，
  // 陪伴页和宠物作息用的是同一份，不再各写一套
  isNight() {
    return timeline.isNight(new Date().getHours());
  },

  tickClock() {
    const clock = this.nowClock();
    const night = this.isNight();
    const patch = {};
    if (clock !== this.data.clock) patch.clock = clock;
    // 页面开着跨过 19 点 / 6 点时，壁纸会自动切换
    if (night !== this.data.night) patch.night = night;
    if (Object.keys(patch).length) this.setData(patch);
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
      this.setData({
        pet: pet || null,
        photo,
        typeEmoji: this.emojiOf(pet && pet.type),
        isDemo: api.isDemo(),
        loading: false
      });
      this.startRoaming();
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '加载失败，请重试' });
    }
  },

  emojiOf(type) {
    if (type === 'cat') return '🐱';
    if (type === 'dog') return '🐶';
    return '🐾';
  },

  // ---------- 自主走动 ----------
  // 用「低频 setData 改 left + CSS transition 补间」实现，避免每帧 setData 掉帧
  startRoaming() {
    this.stopRoaming();
    // 松手后自动恢复走动的那个定时器，别让它把「已经又被拎起来」的宠物拖着走
    clearTimeout(this._dropTimer);
    if (this.data.lifted) return;
    this._roamAlive = true;
    this.walkOnce();
  },

  stopRoaming() {
    this._roamAlive = false;
    clearTimeout(this._moveTimer);
    clearTimeout(this._restTimer);
    clearTimeout(this._bumpTimer);
    clearTimeout(this._shakeTimer);
    clearTimeout(this._runTimer);
    this._walk = null;
    if (this.data.walking || this.data.running) {
      this.setData({ walking: false, running: false });
    }
    if (this.data.shakeCol !== -1) this.setData({ shakeCol: -1 });
  },

  // 走动是 CSS transition 在跑，petX 已是终点值；这里按时间插值算「画面真在哪」，
  // 提起和做动作时用它当基准，宠物才不会先跳到终点
  currentVisualX() {
    const w = this._walk;
    if (!w || !w.duration) return this.data.petX;
    const p = Math.min(1, Math.max(0, (Date.now() - w.start) / w.duration));
    return Math.round((w.from + (w.to - w.from) * p) * 10) / 10;
  },

  walkOnce() {
    if (!this._roamAlive) return;
    const from = this.data.petX;
    // 在 12% ~ 82% 之间换一个落脚点，避免贴边
    let to = 12 + Math.random() * 70;
    if (Math.abs(to - from) < 12) to = from > 50 ? from - 25 : from + 25;
    to = Math.round(Math.max(12, Math.min(82, to)) * 10) / 10;

    const distance = Math.abs(to - from);
    const duration = Math.round(Math.max(1200, Math.min(5200, distance * 90)));

    this.setData({
      petX: to,
      xPx: this.pxOfX(to),
      duration,
      facing: to >= from ? 1 : -1,
      walking: true
    });
    this._walk = { from, to, start: Date.now(), duration };

    this.scheduleIconBump(from, to, distance, duration);

    clearTimeout(this._moveTimer);
    this._moveTimer = setTimeout(() => {
      if (!this._roamAlive) return;
      this._walk = null;
      this.setData({ walking: false });
      // 停下来东张西望一会儿，再继续走。偶尔它也会自己找点事做
      this._restTimer = setTimeout(() => {
        if (Math.random() < 0.4) this.lifeTick();
        this.walkOnce();
      }, 1800 + Math.random() * 2600);
    }, duration + 120);
  },

  // 桌面这层只演氛围：挑一个活动，改表情和心情，冒一句。
  // 场景固定按「室内」算，桌面本身就是室内环境。
  lifeTick() {
    if (!this.data.pet || this.data.lifted || this._dragging || this.data.bubble) return;
    try {
      const pick = petLife.pickActivity('living', this.data.pet.personality);
      const act = pick.activity;
      this.setData({
        expression: act.face,
        moodLabel: pick.mood.label,
        moodFace: pick.mood.face
      });
      this.showBubble(act.emoji + ' ' + act.label, 2400);
      clearTimeout(this._faceTimer);
      this._faceTimer = setTimeout(() => this.setData({ expression: '' }), 2600);
    } catch (e) { /* 本机状态异常时跳过这一轮，不影响走动 */ }
  },

  // 这一趟会经过哪几列图标？走到那一列时停下顶一下，图标跟着抖
  scheduleIconBump(from, to, distance, duration) {
    clearTimeout(this._bumpTimer);
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const hits = [];
    ICON_COLUMNS.forEach((cx, col) => {
      if (cx > lo + 2 && cx < hi - 2) hits.push({ cx, col });
    });
    if (!hits.length) return;

    // 一趟只顶最近的一列，否则一路抖个不停
    const hit = hits.reduce((a, b) => (Math.abs(b.cx - from) < Math.abs(a.cx - from) ? b : a));
    const at = Math.round((Math.abs(hit.cx - from) / Math.max(distance, 1)) * duration);
    this._bumpTimer = setTimeout(() => this.bumpIcon(hit.col), Math.max(0, at));
  },

  bumpIcon(col) {
    // 不依赖 _roamAlive：被抱着放到某列图标上时 roaming 是停着的，也要能顶一下
    if (!this.data.pet) return;
    this.shakeIcon(col);
    this.react('anim-bump');
  },

  // 只抖图标，不动宠物身上的动画（落地时已经有 anim-land 了，别互相覆盖）
  shakeIcon(col) {
    this.setData({ shakeCol: col });
    clearTimeout(this._shakeTimer);
    this._shakeTimer = setTimeout(() => this.setData({ shakeCol: -1 }), 620);
  },

  // ---------- 互动 ----------
  tapPet() {
    if (!this.data.pet) return;
    if (this.data.lifted || this._dragging) return;
    // 刚放下时不响应，避免拖动松手那一下被当成点击
    if (Date.now() - (this._justDropped || 0) < 500) return;

    const now = Date.now();
    const isDouble = this._lastTap && now - this._lastTap < 320;
    this._lastTap = now;
    if (isDouble) {
      this._lastTap = 0;
      this.showBubble(randomFrom(CHAT_PHRASES));
      this.react('anim-bounce');
      setTimeout(() => wx.navigateTo({ url: '/pages/chat/chat' }), 420);
      return;
    }
    this.playAction('touch');
  },

  // 底部 Dock：说话 / 喂饭 / 陪玩 / 回陪伴页
  onDockTap(e) {
    const type = (e.currentTarget.dataset || {}).type;
    if (type === 'chat') { this.goChat(); return; }
    if (type === 'home') { this.goCompanion(); return; }
    // 手里抱着它的时候不喂饭——先放下
    if (!this.data.pet || this.data.lifted) return;
    this.playAction(type);
  },

  // #9：用户为这个场景写过的反应，优先用它；没写过就回到通用文案池
  reactionPool(type, fallback) {
    const pet = this.data.pet || {};
    const scenes = (pet.persona && pet.persona.scenes) || {};
    const text = String(scenes[type] || '').trim();
    if (text) return [text];
    return fallback;
  },

  playAction(type) {
    const fallback = type === 'feed' ? FEED_PHRASES : type === 'play' ? PLAY_PHRASES : TOUCH_PHRASES;
    const pool = this.reactionPool(type, fallback);
    // 记一笔互动，给「一封信」当素材
    moments.bump(type);
    // 你的动作会改它的心情，心情再带到对话里去
    try {
      const live = petLife.onInteraction(type);
      const meta = petLife.moodMeta(live.mood);
      this.setData({ moodLabel: meta.label, moodFace: meta.face });
    } catch (e) { /* ignore */ }
    // 走到半路被叫停：先把位置冻结到画面真值，否则零食/小球会飞到走路的终点去
    const visualX = this.currentVisualX();
    this._walk = null;

    this.setData({
      petX: visualX,
      xPx: this.pxOfX(visualX),
      duration: 0,
      walking: false,
      running: false,
      expression: ACTION_FACE[type] || '',
      food: type === 'feed',
      ball: type === 'play'
    });
    this.showBubble(randomFrom(pool));
    this.emitHearts(type === 'touch' ? 1 : 2);
    this.react(ACTION_ANIM[type] || 'anim-happy');

    if (type === 'feed' && wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'light' }); } catch (err) { /* 部分机型不支持 */ }
    }

    clearTimeout(this._faceTimer);
    clearTimeout(this._propTimer);
    this._faceTimer = setTimeout(() => this.setData({ expression: '' }), 1500);
    this._propTimer = setTimeout(() => this.setData({ food: false, ball: false }), 1300);
  },

  /* ---------- 提起 / 拖走（和陪伴页同一套手感） ---------- */
  onPetTouchStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._dragFrom = {
      x: t.clientX,
      y: t.clientY,
      petX: this.data.petX,
      liftY: this.data.liftY
    };
    this._lastDragX = null;
  },

  // 长按 350ms：被拎起来，脚离地
  onPetLongPress() {
    if (!this.data.pet || this.data.lifted) return;
    const visualX = this.currentVisualX();
    this._dragging = true;
    this.stopRoaming();
    moments.bump('lift');
    this.setData({
      lifted: true,
      petX: visualX,
      xPx: this.pxOfX(visualX),
      duration: 0,
      liftY: -70,
      walking: false,
      running: false,
      expression: '😾'
    });
    // 基准位置换成冻结后的真值，否则手指一动会先跳到走动终点
    if (this._dragFrom) {
      this._dragFrom.liftY = -70;
      this._dragFrom.petX = visualX;
    }
    this.showBubble(randomFrom(this.reactionPool('lift', LIFT_PHRASES)), 2600);
    if (wx.vibrateShort) {
      try { wx.vibrateShort({ type: 'light' }); } catch (err) { /* 部分机型不支持 */ }
    }
  },

  onPetTouchMove(e) {
    if (!this._dragging || !this._dragFrom) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = (t.clientX - this._dragFrom.x) / (this._winWidth || 375) * 100;
    const dy = t.clientY - this._dragFrom.y;
    const x = Math.round(Math.max(10, Math.min(90, this._dragFrom.petX + dx)) * 10) / 10;
    // 只允许往上提，最多离地 180px
    const y = Math.round(Math.max(-180, Math.min(0, this._dragFrom.liftY + dy)));

    // dragging=true 会同时关掉 left/transform 的过渡，手指到哪儿宠物到哪儿
    if (this.data.dragging && x === this.data.petX && y === this.data.liftY) return;

    const bubbleX = Math.max(26, Math.min(74, x));
    const next = {
      dragging: true,
      petX: x,
      xPx: this.pxOfX(x),
      liftY: y,
      bubbleX,
      bubblePx: this.pxOfX(bubbleX)
    };
    const last = this._lastDragX == null ? this._dragFrom.petX : this._lastDragX;
    if (Math.abs(x - last) >= 0.8) {
      next.facing = x > last ? 1 : -1;
      this._lastDragX = x;
    }
    this.setData(next);
  },

  onPetTouchEnd() {
    if (!this._dragging) return;
    this._dragging = false;
    this.dropPet();
  },

  // 松手：落地压扁回弹，顺便看看是不是被放到了某列图标上
  dropPet() {
    this._justDropped = Date.now();
    const dropX = this.data.petX;
    this.setData({
      lifted: false,
      dragging: false,
      duration: 0,
      liftY: 0,
      expression: '😵'
    });
    this.react('anim-land', 700);
    this.showBubble(randomFrom(DROP_PHRASES), 1700);

    const col = this.columnAt(dropX);
    if (col >= 0) this.shakeIcon(col);

    clearTimeout(this._faceTimer);
    this._faceTimer = setTimeout(() => this.setData({ expression: '' }), 900);
    clearTimeout(this._dropTimer);
    this._dropTimer = setTimeout(() => {
      if (this.data.pet && !this.data.loading) this.startRoaming();
    }, 1100);
  },

  columnAt(x) {
    for (let i = 0; i < ICON_COLUMNS.length; i++) {
      if (Math.abs(ICON_COLUMNS[i] - x) < 6) return i;
    }
    return -1;
  },

  goChat() {
    if (!this.data.pet) return;
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  // 双击桌面空白处 → 宠物跑过来
  onDeskTap(e) {
    const now = Date.now();
    const x = e && e.detail && typeof e.detail.x === 'number' ? e.detail.x : null;
    if (this._deskTap && now - this._deskTap < 320) {
      this._deskTap = 0;
      this.runTo(x);
      return;
    }
    this._deskTap = now;
    // 单击不处理，但要给双击留一个过期时间，避免很久后的第二下被当成双击
    clearTimeout(this._deskTapTimer);
    this._deskTapTimer = setTimeout(() => { this._deskTap = 0; }, 400);
  },

  runTo(pageX) {
    if (!this.data.pet) return;
    // 正被拎在手里就先别跑
    if (this.data.lifted) return;
    const w = this._winWidth || 375;
    let target = pageX === null || pageX === undefined ? 50 : (pageX / w) * 100;
    target = Math.max(14, Math.min(80, Math.round(target * 10) / 10));

    // 走到半路被叫过来时，起点要取画面上真在哪，否则距离算错、跑得忽快忽慢
    const from = this.currentVisualX();
    const distance = Math.abs(target - from);
    // 跑比走快得多，同一段路耗时大约是走的三分之一
    const duration = Math.round(Math.max(520, Math.min(1600, distance * 26)));

    this.stopRoaming();
    this.setData({
      petX: target,
      xPx: this.pxOfX(target),
      duration,
      facing: target >= from ? 1 : -1,
      walking: true,
      running: true
    });
    this._walk = { from, to: target, start: Date.now(), duration };
    this.showBubble(randomFrom(COME_PHRASES));

    clearTimeout(this._runTimer);
    this._runTimer = setTimeout(() => {
      this._walk = null;
      this.setData({ running: false, walking: false });
      this.emitHearts(1);
      // 到了之后歇一会儿再恢复自主溜达
      this._restTimer = setTimeout(() => this.startRoaming(), 1600);
    }, duration + 140);
  },

  react(cls, ms) {
    // 重新触发同名动画：先清空再加
    const hold = ms || 900;
    this.setData({ anim: '' });
    clearTimeout(this._animTimer);
    this._animTimer = setTimeout(() => {
      this.setData({ anim: cls });
      clearTimeout(this._animTimer);
      this._animTimer = setTimeout(() => this.setData({ anim: '' }), hold);
    }, 20);
  },

  showBubble(text, holdMs) {
    clearTimeout(this._bubbleTimer);
    // 靠近边缘时把气泡往里收，避免被屏幕裁掉
    const bubbleX = Math.max(26, Math.min(74, this.data.petX));
    this.setData({ bubble: text, bubbleX, bubblePx: this.pxOfX(bubbleX) });
    this._bubbleTimer = setTimeout(() => this.setData({ bubble: '' }), holdMs || 2200);
  },

  emitHearts(count) {
    const next = (this.data.hearts || []).slice();
    // key 带上随机后缀：同一毫秒内连续冒心也不会撞 key
    const seed = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    for (let i = 0; i < count; i++) {
      next.push({ key: seed + '_' + i, left: 20 + Math.random() * 60 });
    }
    this.setData({ hearts: next });
    clearTimeout(this._heartTimer);
    this._heartTimer = setTimeout(() => this.setData({ hearts: [] }), 1300);
  },

  // 桌面图标是装饰，点它如实告知，不假装是系统桌面
  tapIcon(e) {
    const name = (e.currentTarget.dataset || {}).name || '';
    wx.showToast({ title: name + '是装饰，只有它是真的', icon: 'none' });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/companion/companion' })
    });
  },

  goCompanion() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/companion/companion' })
    });
  },

  loadRetry() {
    this.loadPet();
  }
});
