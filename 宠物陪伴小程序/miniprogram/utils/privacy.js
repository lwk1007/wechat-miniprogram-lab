// 微信隐私授权（wx.getPrivacySetting / wx.requirePrivacyAuthorize 体系）
//
// 为什么需要：2023-09 之后，调用相册、相机等隐私接口前必须取得用户同意，
// 否则真机（体验版/正式版）会直接失败。演示模式和开发者工具通常不拦截，
// 所以这个问题只在真机上暴露，必须在专项测试里覆盖。
//
// 用法：
//   1. 页面 onLoad 里 privacy.setShowHandler(() => this.setData({ showPrivacy: true }))
//   2. 调隐私接口前 await privacy.ensure()，返回 false 就中止
//   3. 弹窗「同意」按钮用 open-type="agreePrivacyAuthorization"，
//      触发后调用 privacy.approve()；「暂不」调用 privacy.reject()

let showHandler = null;
let waiting = [];

function supported() {
  return typeof wx !== 'undefined' && typeof wx.getPrivacySetting === 'function';
}

function setShowHandler(fn) {
  showHandler = fn;
}

function clearShowHandler() {
  showHandler = null;
}

// 返回 Promise<boolean>：是否已获得授权
function ensure() {
  return new Promise((resolve) => {
    if (!supported()) return resolve(true); // 老基础库 / 未接入，放行
    wx.getPrivacySetting({
      success: (res) => {
        if (!res || !res.needAuthorization) return resolve(true);
        waiting.push(resolve);
        if (showHandler) showHandler();
      },
      fail: () => resolve(true)
    });
  });
}

function flush(value) {
  const list = waiting;
  waiting = [];
  list.forEach((fn) => fn(value));
}

function approve() {
  flush(true);
}

function reject() {
  flush(false);
}

// 打开小程序后台配置的《用户隐私保护指引》
function openContract() {
  if (typeof wx !== 'undefined' && typeof wx.openPrivacyContract === 'function') {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: '隐私指引暂不可用', icon: 'none' })
    });
  } else {
    wx.showToast({ title: '当前微信版本不支持查看指引', icon: 'none' });
  }
}

module.exports = { supported, ensure, setShowHandler, clearShowHandler, approve, reject, openContract };
