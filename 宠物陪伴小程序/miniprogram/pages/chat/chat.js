const api = require('../../utils/api');

const QUICK_TOPICS = ['今天过得怎么样', '陪我聊聊天', '我想你了', '最近有点累'];

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
    loading: true
  },

  onLoad() {
    this.load();
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
      this.scrollBottom();
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
    this.scrollBottom();
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
      const petMsg = {
        _id: 'p' + Date.now(),
        role: 'pet',
        content: reply.content,
        isDemo: !!reply.isDemo
      };
      this.setData({ messages: this.data.messages.concat([petMsg]), sending: false });
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

  scrollBottom() {
    setTimeout(() => this.setData({ scrollTop: this.data.scrollTop + 99999 }), 100);
  }
});
