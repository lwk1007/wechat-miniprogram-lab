const cloudSvc = require('./utils/cloud');

App({
  globalData: {},
  onLaunch() {
    cloudSvc.init();
  }
});
