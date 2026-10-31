// 动效练习：只改 class 名，动画全交给 CSS
// 核心观念：不要再 JS 里 setData 改 translateY 去做动画（卡 + 费性能），
// 让 CSS transform + keyframes 跑在合成层上，60fps 才稳。
Page({
  data: {
    photo: '',
    anim: 'breath', // breath | jump | sway | none
    taps: 0
  },

  async choose() {
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'] })
      this.setData({ photo: res.tempFiles[0].tempFilePath })
    } catch (e) {
      // 用户取消，忽略
    }
  },

  setAnim(e) {
    const anim = e.currentTarget.dataset.anim
    // 先清空再设置，才能让同一动画重复触发（class 没变化浏览器不会重播）
    this.setData({ anim: '' }, () => {
      this.setData({ anim })
    })
  },

  onPetTap() {
    this.setData({ taps: this.data.taps + 1 })
    wx.vibrateShort && wx.vibrateShort({ type: 'light' })
  }
})
