const config = require('../../config')

const db = () => wx.cloud.database()
const _ = () => db().command

Page({
  data: {
    envReady: false,
    total: 0,
    expired: 0,
    hours: 24,
    log: '还没跑过。先点「演练」看会删多少条，再点「执行」。',
    running: false
  },

  onLoad() {
    const envReady = getApp().globalData.envReady
    this.setData({ envReady })
    if (envReady) this.stat()
  },

  // 统计：总数 + 已过期数量（客户端用 count，只拿数字不拿内容，省流量）
  async stat() {
    try {
      const cutoff = Date.now() - this.data.hours * 3600 * 1000

      const totalRes = await db().collection(config.collection).count()
      const expiredRes = await db()
        .collection(config.collection)
        .where({ createdAt: _.lt(cutoff) })
        .count()

      this.setData({ total: totalRes.total, expired: expiredRes.total })
    } catch (err) {
      this.setData({ log: `统计失败：${err.errMsg || err.message}` })
    }
  },

  // 调云函数：dryRun=true 只统计，false 真删
  async run(e) {
    const dryRun = e.currentTarget.dataset.dry === 'true'
    if (this.data.running) return

    if (!dryRun) {
      const confirm = await wx.showModal({
        title: '确认删除？',
        content: `会永久删除 ${this.data.hours} 小时前的照片（云存储文件 + 数据库记录），不可恢复。`,
        confirmColor: '#e2564c'
      })
      if (!confirm.confirm) return
    }

    this.setData({ running: true, log: dryRun ? '演练中…' : '执行中…' })

    try {
      const res = await wx.cloud.callFunction({
        name: config.functionName,
        data: { dryRun, hours: this.data.hours, collection: config.collection }
      })

      const r = res.result || {}
      this.setData({
        running: false,
        log: [
          `模式：${r.dryRun ? '演练（未删除）' : '真实执行'}`,
          `命中记录：${r.scanned || 0}`,
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
    // 造一条 25 小时前的记录，方便没有历史数据时验证清理逻辑
    try {
      await db()
        .collection(config.collection)
        .add({
          data: { note: '测试用旧记录', createdAt: Date.now() - 25 * 3600 * 1000 }
        })
      wx.showToast({ title: '已造一条旧记录' })
      this.stat()
    } catch (err) {
      wx.showToast({ title: '写入失败', icon: 'none' })
    }
  }
})
