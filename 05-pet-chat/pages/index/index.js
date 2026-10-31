const { reply, GREETING } = require('../../utils/replies')

Page({
  data: {
    messages: [],
    inputValue: '',
    scrollTarget: '',
    typing: false,
    seq: 0
  },

  onLoad() {
    // 冷启动先让"宠物"说一句，比空白的聊天框友好得多
    this.push('pet', GREETING)
  },

  push(role, text) {
    const seq = this.data.seq + 1
    const msg = { id: `msg-${seq}`, role, text }

    this.setData(
      {
        messages: this.data.messages.concat(msg),
        seq,
        scrollTarget: msg.id
      },
      () => this.scrollToBottom()
    )
  },

  scrollToBottom() {
    // 用 scroll-into-view 定位最后一条，比 scroll-top 算高度可靠
    const last = this.data.messages[this.data.messages.length - 1]
    if (last) this.setData({ scrollTarget: last.id })
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },

  send() {
    const text = this.data.inputValue.trim()
    if (!text || this.data.typing) return

    this.push('me', text)
    this.setData({ inputValue: '', typing: true })

    // 模拟"对方在打字"的停顿：没有这个延迟，回答会显得很假
    const delay = 500 + Math.random() * 700
    setTimeout(() => {
      const res = reply(text, { lastText: this._lastText })
      this._lastText = res.nextLast

      this.setData({ typing: false })
      this.push('pet', res.text)
    }, delay)
  },

  // 快捷短语：降低"不知道说什么"的门槛，正价体验里很关键
  quickSend(e) {
    this.setData({ inputValue: e.currentTarget.dataset.text }, () => this.send())
  },

  // 清空重来，方便反复测试文案
  reset() {
    this._lastText = ''
    this.setData({ messages: [], seq: 0, typing: false })
    this.push('pet', GREETING)
  }
})
