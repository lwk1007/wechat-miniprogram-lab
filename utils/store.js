// 极简数据层：购物车 + 订单都存本地缓存
// 想换成云开发时，只需把这里的读写换成数据库操作

const CART_KEY = 'demo_cart_v1'
const ORDER_KEY = 'demo_orders_v1'

function getCart() {
  return wx.getStorageSync(CART_KEY) || []
}

function totalCount(items) {
  const list = items || getCart()
  return list.reduce((sum, item) => sum + item.qty, 0)
}

function cartTotal(items) {
  const list = items || getCart()
  return list.reduce((sum, item) => sum + item.price * item.qty, 0)
}

// 同步购物车角标，非 tabBar 页面调用会失败，这里静默忽略
function syncBadge(items) {
  const count = totalCount(items)
  if (count > 0) {
    wx.setTabBarBadge({
      index: 1,
      text: count > 99 ? '99+' : String(count),
      fail() {}
    })
  } else {
    wx.removeTabBarBadge({ index: 1, fail() {} })
  }
}

function saveCart(items) {
  wx.setStorageSync(CART_KEY, items)
  syncBadge(items)
  return items
}

function addToCart(product) {
  const items = getCart()
  const hit = items.find(item => item.id === product.id)
  if (hit) {
    hit.qty += 1
  } else {
    items.push({
      id: product.id,
      name: product.name,
      price: product.price,
      cover: product.cover,
      qty: 1
    })
  }
  return saveCart(items)
}

function changeQty(id, delta) {
  const items = getCart()
  const hit = items.find(item => item.id === id)
  if (!hit) return items

  hit.qty += delta
  if (hit.qty <= 0) {
    return saveCart(items.filter(item => item.id !== id))
  }
  return saveCart(items)
}

function clearCart() {
  return saveCart([])
}

function getOrders() {
  return wx.getStorageSync(ORDER_KEY) || []
}

function formatTime(date) {
  const pad = n => (n < 10 ? '0' + n : String(n))
  return (
    date.getMonth() +
    1 +
    '月' +
    date.getDate() +
    '日 ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  )
}

function createOrder() {
  const items = getCart()
  if (!items.length) return null

  const order = {
    id: 'D' + Date.now(),
    items: items,
    count: totalCount(items),
    total: cartTotal(items),
    status: '制作中',
    createdAt: formatTime(new Date())
  }

  const orders = getOrders()
  orders.unshift(order)
  wx.setStorageSync(ORDER_KEY, orders)
  clearCart()
  return order
}

module.exports = {
  getCart,
  saveCart,
  addToCart,
  changeQty,
  clearCart,
  cartTotal,
  totalCount,
  syncBadge,
  getOrders,
  createOrder
}
