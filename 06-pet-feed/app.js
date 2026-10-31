const config = require('./config')

App({
  onLaunch() {
    if (!config.envId) {
      console.log('[06-pet-feed] 演示模式，动态存本地缓存')
      return
    }
    wx.cloud.init({ env: config.envId, traceUser: true })
  }
})
