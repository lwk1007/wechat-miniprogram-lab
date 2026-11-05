const cloudSvc = require('./utils/cloud');

App({
  globalData: {
    // 发布/删除动态后置为 true，社区页 onShow 时刷新
    communityDirty: true
  },
  onLaunch() {
    cloudSvc.init();
  }
});
