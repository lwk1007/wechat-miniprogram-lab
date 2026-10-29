const { categories, products } = require('../../utils/data')
const store = require('../../utils/store')

Page({
  data: {
    categories: [{ id: 'all', name: '全部' }].concat(categories),
    activeCat: 'all',
    list: []
  },

  onLoad() {
    this.refresh('all')
  },

  onShow() {
    store.syncBadge()
  },

  // 按分类筛出要渲染的列表，并把首字和带小数点的价格预先算好
  refresh(catId) {
    const decorated = products.map(product =>
      Object.assign({}, product, {
        initial: product.name.slice(0, 1),
        priceText: product.price.toFixed(2)
      })
    )

    this.setData({
      activeCat: catId,
      list:
        catId === 'all'
          ? decorated
          : decorated.filter(product => product.categoryId === catId)
    })
  },

  onSwitchCat(e) {
    this.refresh(e.currentTarget.dataset.id)
  },

  onAdd(e) {
    const id = e.currentTarget.dataset.id
    const product = products.find(item => item.id === id)
    if (!product) return

    store.addToCart(product)
    wx.vibrateShort({ type: 'light', fail() {} })
    wx.showToast({ title: '已加入购物车', icon: 'none', duration: 900 })
  },

  goDetail(e) {
    wx.navigateTo({
      url: '/pages/product/product?id=' + e.currentTarget.dataset.id
    })
  }
})
