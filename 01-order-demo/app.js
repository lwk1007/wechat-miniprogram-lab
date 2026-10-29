const store = require('./utils/store')

App({
  globalData: {
    appName: '拾光咖啡'
  },

  onLaunch() {
    // 首次启动时把购物车数量同步到 tabBar 角标
    store.syncBadge()
  }
})
