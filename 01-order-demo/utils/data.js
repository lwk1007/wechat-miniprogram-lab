// 商品数据：真实项目里这部分来自接口或云数据库
// 换成后端时，只需要把这里替换成 wx.request / wx.cloud.callFunction 的返回值

const categories = [
  { id: 'coffee', name: '咖啡' },
  { id: 'tea', name: '茶饮' },
  { id: 'bakery', name: '烘焙' }
]

const products = [
  {
    id: 'p01',
    categoryId: 'coffee',
    name: '冰美式',
    desc: '双份浓缩 · 冰镇 · 微酸',
    price: 18,
    cover: '#0c447c',
    tag: '招牌'
  },
  {
    id: 'p02',
    categoryId: 'coffee',
    name: '生椰拿铁',
    desc: '厚椰乳 · 半糖 · 常温冰',
    price: 24,
    cover: '#993c1d',
    tag: ''
  },
  {
    id: 'p03',
    categoryId: 'coffee',
    name: '燕麦澳白',
    desc: '燕麦奶 · 双份浓缩',
    price: 26,
    cover: '#534ab7',
    tag: ''
  },
  {
    id: 'p04',
    categoryId: 'tea',
    name: '茉莉毛峰',
    desc: '冷泡 8 小时 · 无糖',
    price: 20,
    cover: '#3b6d11',
    tag: ''
  },
  {
    id: 'p05',
    categoryId: 'tea',
    name: '鸭屎香柠檬茶',
    desc: '手打柠檬 · 少冰',
    price: 22,
    cover: '#854f0b',
    tag: '热销'
  },
  {
    id: 'p06',
    categoryId: 'bakery',
    name: '海盐可颂',
    desc: '现烤 · 每日限量',
    price: 15,
    cover: '#a32d2d',
    tag: ''
  },
  {
    id: 'p07',
    categoryId: 'bakery',
    name: '巴斯克芝士',
    desc: '冷藏 · 微苦回甘',
    price: 28,
    cover: '#993556',
    tag: ''
  }
]

module.exports = {
  categories,
  products
}
