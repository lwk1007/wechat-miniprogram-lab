const api = require('../../api')

Page({
  data: {
    isCloud: api.isCloud,
    photos: [],
    loading: false,
    tip: ''
  },

  onShow() {
    // 从别的页面回来时也要最新数据，所以放 onShow 而不是 onLoad
    this.loadPhotos()
  },

  async loadPhotos() {
    this.setData({ loading: true })

    try {
      const photos = await api.list()
      this.setData({ photos, tip: '', loading: false })
    } catch (err) {
      // 最常见原因：集合没建 / 权限没配
      this.setData({
        loading: false,
        tip: `读取失败：${err.errMsg || err.message}（多半是集合还没建）`
      })
    }
  },

  async pickAndUpload() {
    try {
      // 选图（sizeType 选 compressed 能让微信先粗压一次）
      const picked = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed']
      })

      wx.showLoading({ title: '上传中', mask: true })
      await api.upload(picked.tempFiles[0].tempFilePath)

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

  async removePhoto(e) {
    const { id } = e.currentTarget.dataset
    const record = this.data.photos.find((p) => p._id === id)
    if (!record) return

    const confirm = await wx.showModal({
      title: '删除这张照片？',
      content: '照片会被永久删除，不可恢复',
      confirmColor: '#e8855b'
    })
    if (!confirm.confirm) return

    try {
      await api.remove(record)
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
      urls: this.data.photos.map((p) => p.src)
    })
  }
})
