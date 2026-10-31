const config = require('../../config')

// 云数据库句柄：每次拿到都是同一个客户端实例，调用开销很小
function db() {
  return wx.cloud.database()
}

Page({
  data: {
    envReady: false,
    photos: [],
    loading: false,
    tip: ''
  },

  onLoad() {
    this.setData({ envReady: getApp().globalData.envReady })
  },

  onShow() {
    // 从别的页面回来时也要最新数据，所以放 onShow 而不是 onLoad
    if (this.data.envReady) this.loadPhotos()
  },

  // ---------- 查：读集合 ----------
  async loadPhotos() {
    this.setData({ loading: true })

    try {
      const res = await db()
        .collection(config.collection)
        .orderBy('createdAt', 'desc')
        .limit(20) // 客户端单次上限就是 20，要更多得走分页
        .get()

      this.setData({ photos: res.data, tip: '', loading: false })
    } catch (err) {
      // 最常见原因：集合没建 / 权限没配
      this.setData({
        loading: false,
        tip: `读取失败：${err.errMsg || err.message}（多半是集合 ${config.collection} 还没建）`
      })
    }
  },

  // ---------- 增：选图 → 压缩 → 上传 → 入库 ----------
  async pickAndUpload() {
    if (!this.data.envReady) {
      wx.showModal({
        title: '还没配置云环境',
        content: '打开 config.js，把云开发环境 ID 填进 envId，并在云开发控制台建一个 pets 集合。',
        showCancel: false
      })
      return
    }

    try {
      // 1. 选图（sizeType 选 compressed 能让微信先粗压一次）
      const picked = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed']
      })

      const tempPath = picked.tempFiles[0].tempFilePath

      wx.showLoading({ title: '上传中', mask: true })

      // 2. 再压一次：质量 60 通常能从 3MB 降到 200KB 以内，云存储按量计费，这步很值
      const compressed = await wx.compressImage({ src: tempPath, quality: 60 })

      // 3. 上传云存储：cloudPath 就是云端路径，必须唯一
      const ext = (compressed.tempFilePath.match(/\.(\w+)$/) || [, 'jpg'])[1]
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `pets/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`,
        filePath: compressed.tempFilePath
      })

      // 4. 写数据库：_openid 由云端自动写入，不用自己传
      await db().collection(config.collection).add({
        data: {
          fileID: uploadRes.fileID,
          size: compressed.size || 0,
          createdAt: Date.now()
        }
      })

      wx.hideLoading()
      wx.showToast({ title: '上传成功' })
      this.loadPhotos()
    } catch (err) {
      wx.hideLoading()
      // 用户点了取消不算错误，不弹提示
      if (String(err.errMsg || '').indexOf('cancel') > -1) return
      wx.showToast({ title: '上传失败，看控制台', icon: 'none' })
      console.error('[upload]', err)
    }
  },

  // ---------- 删：先删存储，再删记录 ----------
  async removePhoto(e) {
    const { id, fileid } = e.currentTarget.dataset

    const confirm = await wx.showModal({
      title: '删除这张照片？',
      content: '会同时删掉云存储里的文件，不可恢复',
      confirmColor: '#e8855b'
    })
    if (!confirm.confirm) return

    try {
      await wx.cloud.deleteFile({ fileList: [fileid] })
      await db().collection(config.collection).doc(id).remove()
      this.loadPhotos()
    } catch (err) {
      wx.showToast({ title: '删除失败', icon: 'none' })
      console.error('[remove]', err)
    }
  },

  preview(e) {
    const current = e.currentTarget.dataset.src
    wx.previewImage({
      current,
      urls: this.data.photos.map((p) => p.fileID)
    })
  }
})
