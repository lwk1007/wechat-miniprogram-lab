const { products } = require('../../utils/data')
const store = require('../../utils/store')

Page({
  data: {
    product: null
  },

  onLoad(options) {
    const product = products.find(item => item.id === options.id)

    if (!product) {
      wx.showToast({ title: '商品不存在', icon: 'none' })
      return
    }

    this.setData({
      product: Object.assign({}, product, {
        initial: product.name.slice(0, 1),
        priceText: product.price.toFixed(2)
      })
    })
  },

  onAdd() {
    if (!this.data.product) return
    store.addToCart(this.data.product)
    wx.showToast({ title: '已加入购物车', icon: 'none' })
  },

  goCart() {
    wx.switchTab({ url: '/pages/cart/cart' })
  }
})
