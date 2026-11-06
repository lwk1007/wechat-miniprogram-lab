// 照片立体 · 实验台（#7 的一半）
//
// 这个页面不是给用户用的，是给「要不要做抠图立体」做决策用的：
// 拿一张真实宠物照进来，倾斜手机，看「厚度感」够不够；
// 如果卡片模式就已经够，就不用花钱接分割接口；不够再决定接哪个。
//
// 三层结构（参考 parallax.js 的 depth 语义：0 不动，1 满幅，>1 冲出画面）：
//   back  同一张照片放大 + 模糊，营造背景
//   mid   主体：有抠图用抠图，没有就用照片卡
//   front 高光，位移最大，制造「有东西在画面前面」的错觉
//
// 传感器不可用时会自动降级成手指拖动 —— parallax.js 在无陀螺仪时回退到鼠标，
// 同一个道理：不能因为设备没有陀螺仪就让这个功能变成死的。

const api = require('../../utils/api');
const parallax = require('../../utils/parallax');
const dewhite = require('../../utils/dewhite');

const TYPE_EMOJI = { dog: '🐶', cat: '🐱', rabbit: '🐰', bird: '🐦', fish: '🐟', other: '🐾' };
const STRENGTHS = [12, 18, 26];
const BASELINE_SAMPLES = 8;   // 攒够这么多帧才锁定握持基准
const SENSOR_TIMEOUT = 1800;  // 这么久一帧都没来，判定这台机器没有可用传感器

// 自动摆动：开发者工具和电脑上都读不到陀螺仪，没有这个就只能靠按住拖，
// 拖是在「手动摆一个瞬间」，摆动才是「连续看厚度」，后者才判得准。
const DEMO_TICK = 40;     // 25fps：够顺，setData 次数也不至于太密
const DEMO_CYCLE = 7200;  // 摆一圈 7.2 秒，比人手腕晃得慢一点，看得清

// 去白底前先把图缩到最长边这么多：逐像素跑 JS，2000px 的原图要几百万次循环，
// 而且 getImageData 那一步就能把内存顶爆。480 在手机屏上足够清楚。
const CUT_MAX = 480;

Page({
  data: {
    photo: '',
    cutout: '',
    petName: '',
    emoji: '🐾',

    mode: 'card',
    preset: parallax.PRESETS.card,
    strength: 18,
    strengths: STRENGTHS,
    blur: parallax.PRESETS.card.blur,
    scaleBack: parallax.PRESETS.card.scaleBack,

    off: { back: { x: 0, y: 0 }, mid: { x: 0, y: 0 }, front: { x: 0, y: 0 } },
    // sensor: waiting（还没结论）| on（陀螺仪在工作）| touch（降级成手指拖动）
    sensor: 'waiting',
    demo: false,
    working: false,
    invert: false,
    readout: '等待姿态数据',
    hint: ''
  },

  onLoad() {
    this._base = { x: 0, y: 0 };
    this._samples = [];
    this._unit = { ux: 0, uy: 0 };
    this._lastOff = null;
    this._gotMotion = false;
    this._sensorOn = false;
    this._touchStart = null;
    this._demo = null;
    this.loadPet();
  },

  onShow() {
    this.startSensor();
  },

  onHide() {
    this.stopSensor();
    this.stopDemo();
  },

  onUnload() {
    this.stopSensor();
    this.stopDemo();
  },

  loadPet() {
    api.getPet().then((pet) => {
      if (!pet) {
        this.setData({ hint: '还没有宠物档案：点「选一张照片」试' });
        return;
      }
      this.setData({
        photo: pet.photo || '',
        petName: pet.name || '',
        emoji: TYPE_EMOJI[pet.type] || '🐾'
      });
      if (!pet.photo) {
        this.setData({ hint: '这只还没有照片：点「选一张照片」试' });
      }
    }).catch(() => {
      this.setData({ hint: '读不到档案：点「选一张照片」试' });
    });
  },

  // 开发者工具的模拟器没有陀螺仪。与其等 1.8 秒判死，不如一开始就说清楚能用什么。
  isDevtools() {
    try {
      return wx.getSystemInfoSync().platform === 'devtools';
    } catch (e) {
      return false;
    }
  },

  // ---------- 传感器 ----------

  startSensor() {
    if (this._sensorOn) return;
    if (this.isDevtools()) {
      this.setData({ sensor: 'touch', hint: '模拟器没有陀螺仪：点「自动摆动」，或按住画面拖动' });
      return;
    }
    if (!wx.startDeviceMotionListening || !wx.onDeviceMotionChange) {
      this.setData({ sensor: 'touch', hint: '这台设备不支持陀螺仪，用手指在画面上拖动' });
      return;
    }
    // 监听要先挂上，再开始监听；顺序反了会丢掉最开始几帧
    this._onMotion = (res) => this.handleMotion(res);
    wx.onDeviceMotionChange(this._onMotion);
    wx.startDeviceMotionListening({
      interval: 'ui',
      success: () => {
        this._sensorOn = true;
        this.setData({ sensor: 'waiting' });
        // 有些安卓机 start 成功但一帧都不给，得自己判死
        this._watch = setTimeout(() => {
          if (!this._gotMotion) this.degradeToTouch();
        }, SENSOR_TIMEOUT);
      },
      fail: () => this.degradeToTouch()
    });
  },

  stopSensor() {
    clearTimeout(this._watch);
    if (this._onMotion && wx.offDeviceMotionChange) {
      wx.offDeviceMotionChange(this._onMotion);
    }
    this._onMotion = null;
    if (this._sensorOn && wx.stopDeviceMotionListening) {
      wx.stopDeviceMotionListening({ fail: () => {} });
    }
    this._sensorOn = false;
  },

  degradeToTouch() {
    this.setData({ sensor: 'touch', hint: '没读到陀螺仪：点「自动摆动」，或按住画面拖动' });
  },

  handleMotion(res) {
    const g = res && res.gamma;
    const b = res && res.beta;
    if (typeof g !== 'number' || typeof b !== 'number') return;
    this._gotMotion = true;
    // 真机有传感器就交给传感器，别和演示摆动抢方向
    if (this._demo) this.stopDemo();
    if (this.data.sensor !== 'on') this.setData({ sensor: 'on' });

    // 校准：先攒几帧取均值当基准，之后所有位移都相对它算
    if (this._samples.length < BASELINE_SAMPLES) {
      this._samples.push({ x: g, y: b });
      this._base = parallax.baseline(this._samples);
      if (this._samples.length < BASELINE_SAMPLES) {
        this.setData({ readout: '校准中 ' + this._samples.length + '/' + BASELINE_SAMPLES });
        return;
      }
    }
    this.applyTilt(g, b);
  },

  // 单独抽出来：传感器走这里，手指拖动也走这里，
  // 调试时还能从控制台直接调 applyTilt(15, 60) 看效果
  applyTilt(gamma, beta) {
    const unit = parallax.tiltUnit(gamma, beta, this._base);
    this.pushUnit(unit);
    return unit;
  },

  pushUnit(target) {
    // 低通：陀螺仪原始数据抖动明显，直接用像抖筛子
    this._unit = parallax.smoothUnit(this._unit, target, parallax.SMOOTH_ALPHA);
    const off = parallax.offsets(this._unit, this.data.preset, this.data.strength);
    // 0.3px 以下肉眼看不出，但每帧都发 setData 照样耗电
    if (!parallax.changed(this._lastOff, off)) return;
    this._lastOff = off;
    this.setData({
      off,
      readout: this.readoutOf(this._unit, off)
    });
  },

  readoutOf(unit, off) {
    const pct = (v) => (v >= 0 ? '+' : '') + Math.round(v * 100) / 100;
    return '倾斜 x ' + pct(unit.ux) + ' · y ' + pct(unit.uy)
      + '　主体位移 ' + Math.round(off.mid.x) + ', ' + Math.round(off.mid.y) + ' px';
  },

  // ---------- 自动摆动（电脑 / 模拟器专用） ----------
  //
  // 走椭圆而不是只在一条线上来回：单一方向的位移看起来像图片在平移，
  // 两个轴有一点相位差才会读成「绕着看」。纵向幅度压到 0.5，
  // 因为手持时前后倾的幅度本来就比左右倾小。

  toggleDemo() {
    if (this._demo) {
      this.stopDemo();
      return;
    }
    // 演示时不听传感器，否则两边轮流改方向
    this.stopSensor();
    this._demoT0 = Date.now();
    // 直接从椭圆起点起步：从 0 爬升的话，低通会让前一秒几乎不动，看着像没生效
    this._unit = { ux: 0, uy: 0.5 };
    this._demo = setInterval(() => this.stepDemo(), DEMO_TICK);
    this.stepDemo();
    this.setData({
      demo: true,
      sensor: 'touch',
      hint: '自动摆动着 —— 看背景和主体是不是分开动'
    });
  },

  stepDemo() {
    if (!this._demoT0) return;
    const phase = ((Date.now() - this._demoT0) / DEMO_CYCLE) * Math.PI * 2;
    this.pushUnit({
      ux: Math.sin(phase) * 0.92,
      uy: Math.cos(phase) * 0.5
    });
  },

  stopDemo() {
    clearInterval(this._demo);
    this._demo = null;
    this._demoT0 = 0;
    if (this.data.demo) this.setData({ demo: false });
  },

  // ---------- 手指拖动（降级 / 调试） ----------

  onStageStart(e) {
    this.stopDemo();
    const t = (e.touches && e.touches[0]) || null;
    if (!t) return;
    this._touchStart = { x: t.clientX, y: t.clientY, ux: this._unit.ux, uy: this._unit.uy };
  },

  onStageMove(e) {
    if (!this._touchStart) return;
    const t = (e.touches && e.touches[0]) || null;
    if (!t) return;
    // 手指拖 80px 当作满幅，和 30° 倾斜的手感接近
    const ux = this._touchStart.ux + (t.clientX - this._touchStart.x) / 80;
    const uy = this._touchStart.uy + (t.clientY - this._touchStart.y) / 80;
    this.pushUnit({
      ux: parallax.clamp(ux, -1, 1),
      uy: parallax.clamp(uy, -1, 1)
    });
  },

  onStageEnd() {
    this._touchStart = null;
  },

  // ---------- 参数 ----------

  setMode(e) {
    const mode = (e.currentTarget.dataset || {}).mode || 'card';
    const preset = parallax.PRESETS[mode] || parallax.PRESETS.card;
    this.setData({
      mode,
      preset,
      blur: preset.blur,
      scaleBack: preset.scaleBack
    }, () => this.refreshOffsets());
  },

  // 只有真抠图（带透明通道）才切得动 cutout 模式，没有就提示
  pickMode(e) {
    const mode = (e.currentTarget.dataset || {}).mode || 'card';
    if (mode === 'cutout' && !this.data.cutout) {
      wx.showToast({ title: '还没有抠图，先用卡片模式', icon: 'none' });
      return;
    }
    this.setMode(e);
  },

  setStrength(e) {
    const strength = Number((e.currentTarget.dataset || {}).value) || 18;
    this.setData({ strength }, () => this.refreshOffsets());
  },

  recalibrate() {
    this._samples = [];
    this._unit = { ux: 0, uy: 0 };
    this._lastOff = null;
    this.setData({
      off: { back: { x: 0, y: 0 }, mid: { x: 0, y: 0 }, front: { x: 0, y: 0 } },
      readout: '已重新校准，把手机摆到舒服的角度'
    });
  },

  // 选图只取本地临时路径直接渲染，不上传、不写档案 ——
  // 这张图刷新就没了，宠物档案里的照片还是档案里那张。
  pickPhoto() {
    this.stopDemo();
    const apply = (path) => {
      if (!path) return;
      // 换了照片，之前那张的抠图就不作数了，模式也得退回卡片
      this.setData({
        photo: path,
        cutout: '',
        invert: false,
        mode: 'card',
        preset: parallax.PRESETS.card,
        blur: parallax.PRESETS.card.blur,
        scaleBack: parallax.PRESETS.card.scaleBack,
        hint: '照片已载入：点「自动摆动」看厚度，白底图再点「去白底」'
      }, () => this.refreshOffsets());
    };
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0];
          apply(f && f.tempFilePath);
        },
        // 模拟器/部分版本不支持 chooseMedia，退回 chooseImage
        fail: (err) => this.fallbackChooseImage(apply, err)
      });
      return;
    }
    this.fallbackChooseImage(apply, null);
  },

  fallbackChooseImage(apply, mediaErr) {
    if (!wx.chooseImage) {
      wx.showToast({ title: '这个环境选不了图，用手机预览试', icon: 'none' });
      return;
    }
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => apply(res.tempFilePaths && res.tempFilePaths[0]),
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        // 用户自己取消不算失败，别弹提示
        if (msg.indexOf('cancel') > -1) return;
        if (mediaErr || msg) {
          wx.showToast({ title: '这个环境选不了图，用手机预览试', icon: 'none' });
        }
      }
    });
  },

  // ---------- 去白底 ----------
  //
  // 手绘稿、白墙前拍的、表情包，背景都是一片白纸。这类图根本不需要分割接口：
  // 从四个边往里泛洪，只吃和边框连着的近白色，主体内部的白留着（dewhite.js 里测过）。
  // 抠完自动切到 cutout 模式 —— 这正是这个模式一直空着的位置。

  makeCutout() {
    const src = this.data.photo;
    if (!src) {
      wx.showToast({ title: '先选一张照片', icon: 'none' });
      return;
    }
    if (!wx.createOffscreenCanvas || !wx.canvasToTempFilePath) {
      wx.showToast({ title: '这个基础库版本不支持，用手机试', icon: 'none' });
      return;
    }
    if (this.data.working) return;
    this.setData({ working: true, hint: '正在去白底…' });
    this.cutFromFile(src).then((r) => {
      const lineart = r.kind === 'lineart';
      this.setData({
        cutout: r.path,
        // 线稿只留线条，深色舞台上要翻成亮线才看得见
        invert: lineart,
        mode: 'cutout',
        preset: parallax.PRESETS.cutout,
        blur: parallax.PRESETS.cutout.blur,
        scaleBack: parallax.PRESETS.cutout.scaleBack,
        working: false,
        hint: lineart
          ? '线稿：白纸已去掉，线条翻成亮色（' + Math.round(r.ratio * 100) + '% 是纸），点「自动摆动」看'
          : '白底已去掉（' + Math.round(r.ratio * 100) + '% 是背景），点「自动摆动」看主体浮起来'
      }, () => this.refreshOffsets());
    }).catch((err) => {
      const hint = (err && err.hint) || '去白底失败，换张图试试';
      this.setData({ working: false, hint });
    });
  },

  cutFromFile(src) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src,
        success: (info) => resolve(info),
        fail: reject
      });
    }).then((info) => {
      const scale = Math.min(1, CUT_MAX / Math.max(info.width, info.height));
      const w = Math.max(1, Math.round(info.width * scale));
      const h = Math.max(1, Math.round(info.height * scale));
      return new Promise((resolve, reject) => {
        const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
        const img = canvas.createImage();
        img.onload = () => {
          try {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const frame = ctx.getImageData(0, 0, w, h);
            const kind = dewhite.classify(frame.data, w, h);
            if (kind === 'none') {
              reject({ hint: '这张不是白底，没敢动它。背景里有东西时得接分割接口' });
              return;
            }
            // 线稿不能走泛洪：笔画方框一闭口，身体里的白纸就进不去了。
            // 它要的是「所有纸都透明、只留线条」，所以按亮度直接定透明度。
            let alpha;
            let ratio;
            if (kind === 'lineart') {
              alpha = dewhite.lineArtAlpha(frame.data, w, h);
              ratio = 1 - dewhite.whiteRatio(frame.data, w, h);
              if (ratio < 0.02) {
                reject({ hint: '整张几乎是白纸，没找到线条' });
                return;
              }
            } else {
              const res = dewhite.removeWhite(frame.data, w, h);
              if (!res.applied) {
                reject({ hint: '这张不像白底（边框白色只占 ' + Math.round(res.borderRatio * 100) + '%），没敢动它' });
                return;
              }
              alpha = res.alpha;
              ratio = dewhite.removedRatio(res);
              if (ratio > 0.97) {
                reject({ hint: '整张几乎全白，去掉就什么都不剩了' });
                return;
              }
            }
            dewhite.applyAlpha(frame.data, alpha);
            ctx.putImageData(frame, 0, 0);
            wx.canvasToTempFilePath({
              canvas,
              fileType: 'png',
              success: (out) => resolve({ path: out.tempFilePath, ratio, kind }),
              fail: reject
            });
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = reject;
        img.src = src;
      });
    });
  },

  refreshOffsets() {
    this._lastOff = null;
    const off = parallax.offsets(this._unit, this.data.preset, this.data.strength);
    this._lastOff = off;
    this.setData({ off });
  }
});
