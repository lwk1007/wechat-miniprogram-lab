const voiceMemory = require('../../utils/voice-memory');
const moodLog = require('../../utils/mood-log');

Page({
  data: {
    moodOptions: moodLog.MOOD_KEYS.map((k) => ({
      key: k, face: moodLog.MOODS[k].face, label: moodLog.MOODS[k].label
    })),
    voices: [],
    recording: false,
    recSecs: 0,
    recLevel: 0,
    editing: false,
    draft: null,
    playingId: '',
    playing: false
  },

  onLoad() {
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  onHide() {
    this.stopRecording();
    this.stopPlayback();
  },

  onUnload() {
    this.stopRecording();
    this.stopPlayback();
  },

  refresh() {
    this.setData({ voices: voiceMemory.list() });
  },

  ensureRecorder() {
    if (this._rec) return this._rec;
    const rec = wx.getRecorderManager();
    rec.onStart(() => {
      this._recStartAt = Date.now();
      this._recTimer = setInterval(() => {
        this.setData({ recSecs: Math.floor((Date.now() - this._recStartAt) / 1000) });
      }, 500);
    });
    rec.onStop((res) => {
      this.clearRecTimer();
      if (this._closing) { this.setData({ recording: false }); return; }
      this.setData({ recording: false, recLevel: 0 });
      if (res && res.tempFilePath) {
        this.setData({
          editing: true,
          draft: {
            tempFilePath: res.tempFilePath,
            duration: res.duration || 0,
            title: '',
            mood: '',
            note: ''
          }
        });
      }
    });
    rec.onError(() => {
      this.clearRecTimer();
      this.setData({ recording: false, recLevel: 0 });
      wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' });
    });
    // 实时音量：frameBuffer 是 PCM 分片，算 RMS 归一化到 0-1
    rec.onFrameRecorded((res) => {
      try {
        if (!res || !res.frameBuffer) return;
        const data = new Int16Array(res.frameBuffer);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / Math.max(1, data.length));
        this.setData({ recLevel: Math.min(1, rms / 4000) });
      } catch (e) { /* ignore */ }
    });
    this._rec = rec;
    return rec;
  },

  startRec() {
    if (this.data.recording) return;
    const rec = this.ensureRecorder();
    this.setData({ recording: true, recSecs: 0, recLevel: 0 });
    rec.start({ duration: 60000, sampleRate: 44100, numberOfChannels: 1, encodeBitRate: 128000, format: 'mp3' });
  },

  stopRec() {
    if (!this.data.recording) return;
    try { this._rec && this._rec.stop(); } catch (e) { /* ignore */ }
  },

  stopRecording() {
    this.clearRecTimer();
    if (this.data.recording) {
      this._closing = true;
      try { this._rec && this._rec.stop(); } catch (e) { /* ignore */ }
      this._closing = false;
      this.setData({ recording: false });
    }
  },

  clearRecTimer() {
    if (this._recTimer) { clearInterval(this._recTimer); this._recTimer = null; }
  },

  inputTitle(e) { this.setData({ 'draft.title': e.detail.value }); },
  inputNote(e) { this.setData({ 'draft.note': e.detail.value }); },
  pickMood(e) { this.setData({ 'draft.mood': e.currentTarget.dataset.mood }); },

  cancelDraft() {
    this.setData({ editing: false, draft: null });
  },

  async saveDraft() {
    const d = this.data.draft;
    if (!d || !d.tempFilePath) return;
    wx.showLoading({ title: '珍藏中…', mask: true });
    try {
      const { filePath } = await voiceMemory.persistTemp(d.tempFilePath);
      voiceMemory.add({ title: d.title, mood: d.mood, note: d.note, duration: d.duration, filePath });
      wx.hideLoading();
      this.setData({ editing: false, draft: null });
      this.refresh();
      wx.showToast({ title: '已珍藏', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    }
  },

  play(e) {
    const id = e.currentTarget.dataset.id;
    const v = this.data.voices.find((x) => x._id === id);
    if (!v || !v.filePath) return;
    if (this.data.playingId === id && this.data.playing) {
      this.stopPlayback();
      return;
    }
    this.stopPlayback();
    const audio = wx.createInnerAudioContext();
    audio.src = v.filePath;
    audio.onEnded(() => this.setData({ playingId: '', playing: false }));
    audio.onError(() => {
      this.setData({ playingId: '', playing: false });
      wx.showToast({ title: '播放失败', icon: 'none' });
    });
    audio.play();
    this._audio = audio;
    this.setData({ playingId: id, playing: true });
  },

  stopPlayback() {
    if (this._audio) {
      try { this._audio.stop(); this._audio.destroy(); } catch (e) { /* ignore */ }
      this._audio = null;
    }
    this.setData({ playingId: '', playing: false });
  },

  removeVoice(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这段声音',
      content: '删除后无法恢复，确定吗？',
      confirmColor: '#C06F5C',
      success: (r) => {
        if (!r.confirm) return;
        if (this.data.playingId === id) this.stopPlayback();
        voiceMemory.remove(id);
        this.refresh();
      }
    });
  }
});
