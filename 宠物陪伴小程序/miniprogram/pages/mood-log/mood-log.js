const moodLog = require('../../utils/mood-log');

Page({
  data: {
    MOODS: moodLog.MOODS,
    // 预格式化心情列表，wxml 里直接用 item.face / item.label / item.color
    moodList: moodLog.MOOD_KEYS.map((k) => ({ key: k, label: moodLog.MOODS[k].label, face: moodLog.MOODS[k].face, color: moodLog.MOODS[k].color })),
    today: null,
    selected: '',
    note: '',
    saving: false,
    cells: [],
    year: 0,
    month: 0,
    monthText: '',
    summary: null,
    soothe: null,
    // 呼吸引导
    breathing: false,
    breathStep: '',
    breathLeft: 0,
    breathPhase: 'idle' // idle / in / hold / out
  },

  onLoad() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1 });
    this.refresh();
  },

  onUnload() {
    this.stopBreath();
  },

  refresh() {
    const now = new Date();
    const today = moodLog.getToday();
    const log = moodLog.getLog();
    const cells = moodLog.monthCells(this.data.year, this.data.month, log, now);
    const summary = moodLog.buildSummary(log);

    // 安心卡：今天记过低落心情，就给它一句温和的回应
    let soothe = null;
    const todayMood = today ? today.mood : '';
    if (todayMood && moodLog.needsSoothing(todayMood)) {
      soothe = {
        face: moodLog.MOODS[todayMood].face,
        label: moodLog.MOODS[todayMood].label,
        text: moodLog.sootheText(todayMood)
      };
    }

    this.setData({
      today,
      selected: today ? today.mood : '',
      note: today ? (today.note || '') : '',
      cells,
      summary,
      soothe,
      monthText: this.data.year + '年' + this.data.month + '月'
    });
  },

  pickMood(e) {
    this.setData({ selected: e.currentTarget.dataset.mood });
  },

  onNote(e) {
    this.setData({ note: e.detail.value });
  },

  save() {
    if (this.data.saving) return;
    if (!this.data.selected) {
      wx.showToast({ title: '先选一个心情吧', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      moodLog.setToday(this.data.selected, this.data.note);
      wx.showToast({ title: '已记录', icon: 'success' });
      this.refresh();
    } finally {
      this.setData({ saving: false });
    }
  },

  prevMonth() {
    let { year, month } = this.data;
    month--;
    if (month < 1) { month = 12; year--; }
    this.setData({ year, month });
    this.refresh();
  },

  nextMonth() {
    let { year, month } = this.data;
    month++;
    if (month > 12) { month = 1; year++; }
    this.setData({ year, month });
    this.refresh();
  },

  // ---------- 呼吸引导（box breathing 4-4-4-4）----------
  startBreath() {
    if (this.data.breathing) return;
    this._step = 0;
    this.setData({ breathing: true });
    this.runBreath();
  },

  runBreath() {
    const steps = moodLog.BREATH.steps;
    const total = steps.length * moodLog.BREATH.rounds;
    if (this._step >= total) {
      this.stopBreath();
      return;
    }
    const step = steps[this._step % steps.length];
    // phase 映射：吸气→放大、吸气后屏住→保持大、呼气→缩小、呼气后屏住→保持小
    const idx = this._step % steps.length;
    const phase = idx === 0 ? 'in' : (idx === 1 ? 'holdIn' : (idx === 2 ? 'out' : 'holdOut'));
    this.setData({ breathStep: step.label, breathLeft: step.secs, breathPhase: phase });
    this._left = step.secs;
    this._breathTimer = setInterval(() => {
      this._left--;
      if (this._left <= 0) {
        clearInterval(this._breathTimer);
        this._step++;
        this.runBreath();
      } else {
        this.setData({ breathLeft: this._left });
      }
    }, 1000);
  },

  stopBreath() {
    clearInterval(this._breathTimer);
    this.setData({ breathing: false, breathStep: '', breathLeft: 0, breathPhase: 'idle' });
  }
});
