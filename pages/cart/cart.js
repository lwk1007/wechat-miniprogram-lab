const store = require('../../utils/store')

Page({
  data: {
    items: [],
    count: 0,
    totalText: '0.00'
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const items = store.getCart()
    this.setData({
      items: items.map(item =>
        Object.assign({}, item, {
          initial: item.name.slice(0, 1),
          lineTotal: (item.price * item.qty).toFixed(2)
        })
      ),
      count: store.totalCount(items),
      totalText: store.cartTotal(items).toFixed(2)
    })
    store.syncBadge(items)
  },

  onMinus(e) {
    store.changeQty(e.currentTarget.dataset.id, -1)
    this.refresh()
  },

  onPlus(e) {
    store.changeQty(e.currentTarget.dataset.id, 1)
    this.refresh()
  },

  onClear() {
    wx.showModal({
      title: '清空购物车',
      content: '确定要移除全部商品吗？',
      confirmColor: '#d85a30',
      success: res => {
        if (!res.confirm) return
        store.clearCart()
        this.refresh()
      }
    })
  },

  onSubmit() {
    if (!this.data.items.length) {
      wx.showToast({ title: '购物车还是空的', icon: 'none' })
      return
    }

    const order = store.createOrder()
    if (!order) return

    wx.showToast({ title: '下单成功', icon: 'success', duration: 900 })
    this.refresh()

    setTimeout(() => {
      wx.switchTab({ url: '/pages/orders/orders' })
    }, 900)
  }
})
