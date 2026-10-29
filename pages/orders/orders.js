const store = require('../../utils/store')

Page({
  data: {
    orders: []
  },

  onShow() {
    const orders = store.getOrders().map(order =>
      Object.assign({}, order, {
        summary: order.items
          .map(item => item.name + ' × ' + item.qty)
          .join(' · '),
        totalText: order.total.toFixed(2)
      })
    )

    this.setData({ orders })
    store.syncBadge()
  },

  onPullDownRefresh() {
    this.onShow()
    wx.stopPullDownRefresh()
  },

  goMenu() {
    wx.switchTab({ url: '/pages/menu/menu' })
  }
})
