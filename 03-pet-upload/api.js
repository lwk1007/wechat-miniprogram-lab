/**
 * 数据层：同一套页面，两套数据通道
 *
 * - config.envId 有值 → 走云开发（wx.cloud 上传文件 + 云数据库）
 * - config.envId 为空 → 走本地演示（wx.setStorageSync 存 base64）
 *
 * 为什么要有这一层：页面里不该出现 wx.cloud.xxx。
 * 页面只管"拿到列表、传一张图、删一条"，数据从哪来由这里决定。
 * 这样以后接自建后端，只换这个文件，页面一行不用动。
 */

const config = require('./config')

const IS_CLOUD = !!config.envId
const KEY = 'demo_pets'
const DEMO_MAX = 6 // 本地存储全局上限 10MB，演示模式只留最近 6 张

// 同一毫秒内连点两次会撞时间戳，必须加随机后缀才保证唯一
const localId = () => `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/* ------------------------- 演示模式 ------------------------- */

function readLocal() {
  return wx.getStorageSync(KEY) || []
}

function writeLocal(list) {
  wx.setStorageSync(KEY, list)
}

// 临时文件重启后会被回收，所以必须转成 base64 才能长期显示
function toBase64(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(`data:image/jpeg;base64,${res.data}`),
      fail: reject
    })
  })
}

async function localUpload(tempPath) {
  const compressed = await wx.compressImage({ src: tempPath, quality: 45 })
  const src = await toBase64(compressed.tempFilePath)

  const record = {
    _id: localId(),
    src,
    size: compressed.size || 0,
    createdAt: Date.now()
  }

  // 新的放最前，超额的从尾部丢掉
  const list = [record].concat(readLocal()).slice(0, DEMO_MAX)
  writeLocal(list)
  return record
}

/* ------------------------- 云开发模式 ------------------------- */

async function cloudUpload(tempPath) {
  // 压缩：3MB 降到 200KB 以内，云存储按量计费，这步很值
  const compressed = await wx.compressImage({ src: tempPath, quality: 60 })
  const ext = (compressed.tempFilePath.match(/\.(\w+)$/) || [, 'jpg'])[1]

  const up = await wx.cloud.uploadFile({
    cloudPath: `pets/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`,
    filePath: compressed.tempFilePath
  })

  // _openid 由云端自动写入，不用自己传
  const added = await wx.cloud.database().collection(config.collection).add({
    data: { fileID: up.fileID, size: compressed.size || 0, createdAt: Date.now() }
  })

  return { _id: added._id, src: up.fileID, size: compressed.size || 0, createdAt: Date.now() }
}

/* ------------------------- 对外统一接口 ------------------------- */

module.exports = {
  isCloud: IS_CLOUD,

  // 读列表：两边都返回 [{ _id, src, size, createdAt }]
  async list() {
    if (!IS_CLOUD) return readLocal()

    const res = await wx.cloud
      .database()
      .collection(config.collection)
      .orderBy('createdAt', 'desc')
      .limit(20) // 客户端单次上限 20，更多要走分页
      .get()

    return res.data.map((d) => ({
      _id: d._id,
      src: d.fileID,
      size: d.size,
      createdAt: d.createdAt
    }))
  },

  async upload(tempPath) {
    return IS_CLOUD ? cloudUpload(tempPath) : localUpload(tempPath)
  },

  async remove(record) {
    if (!IS_CLOUD) {
      writeLocal(readLocal().filter((r) => r._id !== record._id))
      return
    }
    // 顺序不能反：先删存储文件，再删数据库记录
    await wx.cloud.deleteFile({ fileList: [record.src] })
    await wx.cloud.database().collection(config.collection).doc(record._id).remove()
  }
}
