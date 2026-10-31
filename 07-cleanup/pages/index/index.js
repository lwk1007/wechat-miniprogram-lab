const api = require('../../api')

Page({
  data: {
    isCloud: api.isCloud,
    total: 0,
    expired: 0,
    hours: 24,
    log: '还没跑过。先点「演练」看会删多少条，再点「执行」。',
    running: false
  },

  onLoad() {
    this.stat()
  },

  async stat() {
    try {
      const { total, expired } = await api.stat(this.data.hours)
      this.setData({ total, expired })
    } catch (err) {
      this.setData({ log: `统计失败：${err.errMsg || err.message}` })
    }
  },

  async run(e) {
    const dryRun = e.currentTarget.dataset.dry === 'true'
    if (this.data.running) return

    if (!dryRun) {
      const confirm = await wx.showModal({
        title: '确认删除？',
        content: `会永久删除 ${this.data.hours} 小时前的照片（文件 + 记录），不可恢复。`,
        confirmColor: '#e2564c'
      })
      if (!confirm.confirm) return
    }

    this.setData({ running: true, log: dryRun ? '演练中…' : '执行中…' })

    try {
      const r = await api.run({ dryRun, hours: this.data.hours })

      this.setData({
        running: false,
        log: [
          `模式：${r.dryRun ? '演练（未删除）' : '真实执行'}`,
          `命中过期：${r.scanned || 0}`,
          `删除记录：${r.deletedDocs || 0}`,
          `删除文件：${r.deletedFiles || 0}`,
          r.error ? `错误：${r.error}` : '',
          r.fileErrors && r.fileErrors.length ? `文件错误：${r.fileErrors.join('; ')}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      })

      this.stat()
    } catch (err) {
      this.setData({
        running: false,
        log: `调用失败：${err.errMsg || err.message}\n（云函数是否已上传部署？）`
      })
    }
  },

  async addOldRecord() {
    try {
      await api.addOldRecord()
      wx.showToast({ title: '已造一条旧记录' })
      this.stat()
    } catch (err) {
      wx.showToast({ title: '写入失败', icon: 'none' })
      console.error('[addOldRecord]', err)
    }
  }
})
