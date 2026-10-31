const config = require('./config')

App({
  onLaunch() {
    if (!config.envId) {
      console.warn('[06-pet-feed] 还没填 config.js 里的 envId')
      return
    }
    wx.cloud.init({ env: config.envId, traceUser: true })
  },

  globalData: {
    envReady: !!config.envId
  }
})
