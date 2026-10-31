const config = require('../../config')

Page({
  data: {
    nickname: '',
    content: '',
    images: [],
    submitting: false
  },

  onLoad() {
    const saved = wx.getStorageSync('pet_nickname') || ''
    this.setData({ nickname: saved })
  },

  onNickname(e) {
    this.setData({ nickname: e.detail.value })
  },

  onContent(e) {
    this.setData({ content: e.detail.value })
  },

  async chooseImages() {
    const remain = 9 - this.data.images.length
    if (remain <= 0) return

    try {
      const res = await wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sizeType: ['compressed']
      })
      const paths = res.tempFiles.map((f) => f.tempFilePath)
      this.setData({ images: this.data.images.concat(paths) })
    } catch (e) {
      // 取消选择
    }
  },

  removeImage(e) {
    const idx = e.currentTarget.dataset.idx
    const images = this.data.images.slice()
    images.splice(idx, 1)
    this.setData({ images })
  },

  preview(e) {
    const src = e.currentTarget.dataset.src
    wx.previewImage({ current: src, urls: this.data.images })
  },

  async submit() {
    const content = this.data.content.trim()
    if (!content && !this.data.images.length) {
      wx.showToast({ title: '写点什么或发张图', icon: 'none' })
      return
    }
    if (this.data.submitting) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中', mask: true })

    try {
      // 图片先并发上传，拿 fileID 数组；任一失败就整体失败，避免发出半截内容
      const uploads = await Promise.all(
        this.data.images.map(async (path, i) => {
          const ext = (path.match(/\.(\w+)$/) || [, 'jpg'])[1]
          const res = await wx.cloud.uploadFile({
            cloudPath: `posts/${Date.now()}-${i}.${ext}`,
            filePath: path
          })
          return res.fileID
        })
      )

      const nickname = this.data.nickname.trim() || '宠友'
      wx.setStorageSync('pet_nickname', nickname)

      await wx.cloud.database().collection(config.collection).add({
        data: {
          nickname,
          content,
          images: uploads,
          likeCount: 0,
          createdAt: Date.now()
        }
      })

      wx.hideLoading()
      wx.showToast({ title: '发布成功' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (err) {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: '发布失败', icon: 'none' })
      console.error('[publish]', err)
    }
  }
})
