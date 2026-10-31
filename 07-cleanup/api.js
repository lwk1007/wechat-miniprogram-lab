/**
 * 数据层：演示模式（本地模拟清理）/ 云开发模式（真实云函数）
 *
 * 演示模式不是"假装成功"，而是真的按同样的规则算过期、真的删本地记录。
 * 目的是让你先看清「扫描 → 命中 → 删除」这套流程，再去抄到云函数里。
 */

const config = require('./config')

const IS_CLOUD = !!config.envId
const KEY = 'demo_cleanup_pets'

const readLocal = () => wx.getStorageSync(KEY) || []
const writeLocal = (list) => wx.setStorageSync(KEY, list)

const localId = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

module.exports = {
  isCloud: IS_CLOUD,

  // 云端用 count() 只拿数字，不拉内容，省流量
  // 本地数量本来就不大，直接算
  async stat(hours) {
    const cutoff = Date.now() - hours * 3600 * 1000

    if (!IS_CLOUD) {
      const list = readLocal()
      return {
        total: list.length,
        expired: list.filter((r) => r.createdAt < cutoff).length
      }
    }

    const db = wx.cloud.database()
    const totalRes = await db.collection(config.collection).count()
    const expiredRes = await db
      .collection(config.collection)
      .where({ createdAt: db.command.lt(cutoff) })
      .count()

    return { total: totalRes.total, expired: expiredRes.total }
  },

  async addOldRecord() {
    // 造一条 25 小时前的记录，没有历史数据时也能验证清理逻辑
    const record = { _id: localId(), note: '测试用旧记录', createdAt: Date.now() - 25 * 3600 * 1000 }

    if (!IS_CLOUD) {
      writeLocal([record].concat(readLocal()))
      return record
    }

    await wx.cloud.database().collection(config.collection).add({
      data: { note: record.note, createdAt: record.createdAt }
    })
    return record
  },

  // dryRun=true 只统计不删，false 真删
  async run({ dryRun, hours }) {
    if (!IS_CLOUD) {
      const cutoff = Date.now() - hours * 3600 * 1000
      const list = readLocal()
      const expired = list.filter((r) => r.createdAt < cutoff)

      if (!dryRun) writeLocal(list.filter((r) => r.createdAt >= cutoff))

      return {
        dryRun,
        total: list.length,
        // 和云函数保持一致：scanned 是"命中过期"的条数（演练时就是预计会删的数量）
        scanned: expired.length,
        deletedDocs: dryRun ? 0 : expired.length,
        deletedFiles: dryRun ? 0 : expired.length,
        fileErrors: []
      }
    }

    const res = await wx.cloud.callFunction({
      name: config.functionName,
      data: { dryRun, hours, collection: config.collection }
    })

    return res.result || {}
  }
}
