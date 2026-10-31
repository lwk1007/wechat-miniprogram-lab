const pets = [
  { id: 1, name: '豆豆', mood: '开心', days: 128, color: '#e8855b' },
  { id: 2, name: '芝麻', mood: '想你了', days: 64, color: '#7c9c8a' },
  { id: 3, name: '年糕', mood: '困了', days: 12, color: '#b08bc0' }
]

Page({
  data: {
    pets,
    lastTap: null
  },

  // 父页面接收子组件抛出的事件：bind:cardtap 对应 triggerEvent('cardtap')
  onCardTap(e) {
    const { name, days } = e.detail
    this.setData({ lastTap: `${name}（${days} 天）` })

    wx.showToast({ title: `你点了 ${name}`, icon: 'none' })
  },

  // 演示「数据驱动」：改 data 后界面自动更新，没有 DOM 操作
  addPet() {
    const all = this.data.pets
    const next = {
      id: Date.now(),
      name: '新朋友' + (all.length + 1),
      mood: '刚到家',
      days: 0,
      color: '#d9a15b'
    }

    this.setData({ pets: all.concat(next) })
  }
})
