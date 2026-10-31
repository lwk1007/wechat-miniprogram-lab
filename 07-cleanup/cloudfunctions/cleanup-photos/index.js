// 云函数运行在服务端，用 wx-server-sdk（不是 wx.cloud）
// 它拿到的是管理员权限：能删别人创建的记录，也能删云存储文件
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const HOURS = 24
const BATCH = 100 // 云函数单次查询上限 100

/**
 * 清理 24 小时前的宠物照片（对应产品承诺"照片 24 小时内自动删除"）
 *
 * 入参：
 *   dryRun   默认 true，只统计不删除。上线前请手动传 false 验一次
 *   hours    自定义过期小时数，默认 24
 *   collection 集合名，默认 pets
 */
exports.main = async (event = {}) => {
  const dryRun = event.dryRun !== false
  const hours = Number(event.hours) || HOURS
  const collection = event.collection || 'pets'
  const cutoff = Date.now() - hours * 3600 * 1000

  const result = {
    dryRun,
    hours,
    collection,
    cutoffTime: new Date(cutoff).toISOString(),
    scanned: 0,
    deletedDocs: 0,
    deletedFiles: 0,
    fileErrors: []
  }

  try {
    while (true) {
      const res = await db
        .collection(collection)
        .where({ createdAt: db.command.lt(cutoff) })
        .limit(BATCH)
        .get()

      if (!res.data.length) break

      result.scanned += res.data.length

      // 演练模式：只报数量，不动数据
      if (dryRun) break

      // 1. 先删云存储文件（fileID 是 cloud:// 开头的字符串）
      const fileList = res.data.map((d) => d.fileID).filter(Boolean)
      if (fileList.length) {
        try {
          const delRes = await cloud.deleteFile({ fileList })
          result.deletedFiles += (delRes.fileList || []).filter((f) => f.status === 0).length
        } catch (err) {
          result.fileErrors.push(err.message || String(err))
        }
      }

      // 2. 再删数据库记录（先删文件再删记录，避免记录没了文件成孤儿）
      for (const doc of res.data) {
        await db.collection(collection).doc(doc._id).remove()
        result.deletedDocs += 1
      }

      // 少于一批说明清完了
      if (res.data.length < BATCH) break
    }

    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err.message || String(err), ...result }
  }
}
