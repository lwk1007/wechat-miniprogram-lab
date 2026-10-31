const config = require('./config')

App({
  onLaunch() {
    if (!config.envId) {
      console.warn('[03-pet-upload] 还没填 config.js 里的 envId，云开发调用会失败')
      return
    }

    // 全局初始化一次，页面里就能直接用 wx.cloud.database() / uploadFile()
    wx.cloud.init({ env: config.envId, traceUser: true })
  },

  globalData: {
    envReady: !!config.envId
  }
})
