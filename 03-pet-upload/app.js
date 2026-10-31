const config = require('./config')

App({
  onLaunch() {
    // 演示模式：没有 envId 就用本地缓存，照样能把整条链路点通
    if (!config.envId) {
      console.log('[03-pet-upload] 演示模式，数据存本地缓存在')
      return
    }
    wx.cloud.init({ env: config.envId, traceUser: true })
  }
})
