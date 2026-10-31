const config = require('./config')

App({
  onLaunch() {
    if (!config.envId) {
      console.log('[07-cleanup] 演示模式，清理逻辑在本地模拟')
      return
    }
    wx.cloud.init({ env: config.envId, traceUser: true })
  }
})
