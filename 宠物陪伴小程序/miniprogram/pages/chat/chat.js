const api = require('../../utils/api');
const voice = require('../../utils/voice');
const privacy = require('../../utils/privacy');

// #4 对话升级：
//   - 文本侧：逐字输出（打字机），让「等模型」变成「看它说」
//   - 语音输入：同声传译插件录音转文字，松手直接发
//   - 语音输出：回复自动播报，或长按气泡重听
// 三者都做了降级：插件没启用时麦克风按钮仍在，点了给出启用路径，打字聊天不受影响。

const QUICK_TOPICS = ['今天过得怎么样', '陪我聊聊天', '我想你了', '最近有点累'];

// 打字机节奏：50 字左右的回复，约 1 秒打完。
// 比这更快就看不清是在“说”，更慢会让人觉得卡。
const TYPE_SPEED = 40;
const TYPE_STEP = 2;
// 距底部多少 px 内算「贴着底部」。用户往上翻历史时不强推滚动。
const NEAR_BOTTOM = 1000;

Page({
  data: {
    pet: null,
    petEmoji: '🐾',
    messages: [],
    input: '',
    sending: false,
    isDemo: true,
    scrollTop: 0,
    error: '',
    loading: true,
    quickTopics: QUICK_TOPICS,
    // 语音
    voiceMode: false,
    recording: false,
    partial: '',
    ttsAuto: false,
    voiceReady: false,
    // 新消息提示（用户翻历史时出现）
    hasNew: false,
    showPrivacy: false
  },

  onLoad() {
    this._nearBottom = true;
    this._typeTimer = null;
    // 录音的隐私授权复用同一套弹窗
    privacy.setShowHandler(() => this.setData({ showPrivacy: true }));
    this.setData({
      ttsAuto: voice.isAutoTts(),
      voiceReady: voice.status() === 'ok'
    });
    this.load();
  },

  onUnload() {
    privacy.clearShowHandler();
    this.clearTypeTimer();
    if (this.recognizer) {
      this.recognizer.destroy();
      this.recognizer = null;
    }
    voice.destroy();
  },

  onHide() {
    // 切走就停播，别在黑屏后面继续说话
    voice.stop();
    this.clearTypeTimer();
  },

  clearTypeTimer() {
    if (this._typeTimer) {
      clearInterval(this._typeTimer);
      this._typeTimer = null;
    }
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
          title: '还没有宠物',
          content: '先去创建一只，再来聊天吧',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }
      const history = await api.getChatHistory();
      this.setData({
        pet,
        petEmoji: pet.type === 'cat' ? '🐱' : pet.type === 'dog' ? '🐶' : '🐾',
        messages: (history || []).map((m) => this.decorate(m)),
        isDemo: api.isDemo(),
        loading: false
      });
      this.scrollBottom(true);
    } catch (e) {
      this.setData({ loading: false, error: e.message || '加载失败' });
    }
  },

  decorate(m) {
    const msg = Object.assign({}, m);
    if (msg.role === 'user') msg.status = 'ok';
    return msg;
  },

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  async send() {
    const text = this.data.input.trim();
    if (!text || this.data.sending) return;
    this.doSend(text);
  },

  onTopic(e) {
    if (this.data.sending) return;
    this.doSend(e.currentTarget.dataset.topic);
  },

  doSend(text) {
    const msg = {
      _id: 'u' + Date.now(),
      role: 'user',
      content: text,
      status: 'sending'
    };
    const messages = this.data.messages.concat([msg]);
    this.setData({ messages, input: '', sending: true });
    this.scrollBottom(true);
    this.requestReply(msg);
  },

  // 重发失败的消息
  retrySend(e) {
    if (this.data.sending) return;
    const id = e.currentTarget.dataset.id;
    const idx = this.data.messages.findIndex((m) => m._id === id);
    if (idx < 0) return;
    const msg = this.data.messages[idx];
    this.setData({
      ['messages[' + idx + '].status']: 'sending',
      sending: true
    });
    this.requestReply(msg);
  },

  async requestReply(userMsg) {
    const idx = this.data.messages.findIndex((m) => m._id === userMsg._id);
    try {
      const reply = await api.sendChat(userMsg.content);
      if (idx >= 0) this.setData({ ['messages[' + idx + '].status']: 'ok' });

      // 先插入一条空气泡，再把文字逐字填进去。
      // 不直接显示完整回复，是因为用户对等待的感知在「出字之后」才真正缓解。
      const petMsg = {
        _id: 'p' + Date.now(),
        role: 'pet',
        content: '',
        typing: true,
        isDemo: !!reply.isDemo
      };
      const messages = this.data.messages.concat([petMsg]);
      this.setData({ messages, sending: false });
      this.scrollBottom();

      await this.typeIn(messages.length - 1, reply.content || '');

      // 打完再播报，否则会「先听到后看到」
      if (this.data.ttsAuto) {
        voice.speak(reply.content || '');
      }
    } catch (e) {
      if (idx >= 0) {
        this.setData({
          ['messages[' + idx + '].status']: 'failed',
          ['messages[' + idx + '].error']: e.message || '发送失败'
        });
      }
      this.setData({ sending: false });
    }
    this.scrollBottom();
  },

  typeIn(index, full) {
    return new Promise((resolve) => {
      if (!full) {
        this.setData({ ['messages[' + index + '].typing']: false });
        resolve();
        return;
      }
      let i = 0;
      let tick = 0;
      this.clearTypeTimer();
      this._typeTimer = setInterval(() => {
        i = Math.min(full.length, i + TYPE_STEP);
        tick++;
        const done = i >= full.length;
        const patch = {
          ['messages[' + index + '].content']: full.slice(0, i),
          ['messages[' + index + '].typing']: !done
        };
        // 滚动跟内容合并进同一次 setData：逐帧滚动会额外触发一次渲染，
        // 40ms 一帧叠起来在低端安卓机上很明显。每 4 帧（约 160ms）跟一次足够顺。
        // 但用户正在往上翻历史时不能跟——否则每 160ms 把他拽回底部一次。
        if ((done || tick % 4 === 0) && this._nearBottom !== false) {
          patch.scrollTop = this.data.scrollTop + 99999;
          patch.hasNew = false;
        }
        this.setData(patch);
        if (done) {
          this.clearTypeTimer();
          resolve();
        }
      }, TYPE_SPEED);
    });
  },

  // ---------- 语音输入 ----------

  toggleVoiceMode() {
    const next = !this.data.voiceMode;
    if (next && voice.status() !== 'ok') {
      wx.showModal({
        title: '语音还没启用',
        content: voice.unavailableTip() + '\n\n仍然可以用文字聊天。',
        showCancel: false
      });
      // 仍然切过去，让用户看到按钮在哪、知道有这功能
    }
    this.setData({ voiceMode: next });
  },

  async onVoiceStart() {
    if (this.data.sending || this._startingVoice) return;
    this._startingVoice = true;
    try {
      if (voice.status() !== 'ok') {
        wx.showModal({ title: '语音还没启用', content: voice.unavailableTip(), showCancel: false });
        return;
      }
      // 录音属于隐私接口，先过隐私授权再要系统麦克风权限
      const allowed = await privacy.ensure();
      if (!allowed) {
        wx.showToast({ title: '未同意隐私授权，暂时无法使用语音', icon: 'none' });
        return;
      }
      const perm = await voice.ensureRecordPermission();
      if (perm === 'denied') {
        wx.showModal({
          title: '需要麦克风权限',
          content: '在设置里打开麦克风后就能用语音聊天了',
          confirmText: '去设置',
          success: (res) => { if (res.confirm && wx.openSetting) wx.openSetting(); }
        });
        return;
      }

      if (!this.recognizer) {
        this.recognizer = voice.createRecognizer({
          onPartial: (text) => this.setData({ partial: text }),
          onStop: (text) => this.handleVoiceResult(text),
          onError: () => {
            this.setData({ recording: false, partial: '' });
            wx.showToast({ title: '没听清，再说一次？', icon: 'none' });
          }
        });
      }
      if (!this.recognizer) {
        wx.showModal({ title: '语音不可用', content: voice.unavailableTip(), showCancel: false });
        return;
      }

      this.setData({ recording: true, partial: '' });
      const started = this.recognizer.start();
      if (!started) {
        this.setData({ recording: false });
        wx.showToast({ title: '录音启动失败', icon: 'none' });
      }
    } finally {
      this._startingVoice = false;
    }
  },

  onVoiceEnd() {
    if (!this.data.recording) return;
    this.setData({ recording: false, partial: '' });
    if (this.recognizer) this.recognizer.stop();
  },

  onVoiceCancel() {
    if (!this.data.recording) return;
    this._dropNextResult = true;
    this.setData({ recording: false, partial: '' });
    if (this.recognizer) this.recognizer.stop();
  },

  handleVoiceResult(text) {
    if (this._dropNextResult) {
      this._dropNextResult = false;
      return;
    }
    const content = (text || '').trim();
    if (!content) {
      wx.showToast({ title: '没听清，再说一次？', icon: 'none' });
      return;
    }
    if (this.data.sending) {
      // 上一句还在回，先填进输入框让用户自己决定
      this.setData({ input: content, voiceMode: false });
      wx.showToast({ title: '它还在回上一句，先放输入框里', icon: 'none' });
      return;
    }
    // 松手即发，这是「打语音」的直觉
    this.doSend(content);
  },

  // ---------- 语音输出 ----------

  toggleTts() {
    if (voice.status() !== 'ok') {
      wx.showModal({ title: '语音播报还没启用', content: voice.unavailableTip(), showCancel: false });
      return;
    }
    const next = !this.data.ttsAuto;
    voice.setAutoTts(next);
    this.setData({ ttsAuto: next });
    if (next) voice.speak('好，我会念给你听', { force: true });
    else voice.stop();
  },

  // 长按气泡重听（只对宠物说的生效）
  replay(e) {
    const ds = e.currentTarget.dataset || {};
    if (ds.role !== 'pet') return;
    if (!ds.content) return;
    if (voice.status() !== 'ok') {
      wx.showToast({ title: '语音播报未启用', icon: 'none' });
      return;
    }
    voice.speak(ds.content, { force: true });
  },

  // ---------- 滚动 ----------

  onScroll(e) {
    const d = e.detail || {};
    this._nearBottom = (d.scrollHeight - d.scrollTop) < NEAR_BOTTOM;
  },

  scrollBottom(force) {
    if (!force && this._nearBottom === false) {
      if (!this.data.hasNew) this.setData({ hasNew: true });
      return;
    }
    this.setData({ hasNew: false, scrollTop: this.data.scrollTop + 99999 });
  },

  jumpToBottom() {
    this._nearBottom = true;
    this.setData({ hasNew: false, scrollTop: this.data.scrollTop + 99999 });
  }
});
