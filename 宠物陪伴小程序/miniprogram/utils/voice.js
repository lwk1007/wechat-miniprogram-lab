// 语音播报（可选能力）
//
// 小程序没有系统级 TTS，想让它「说话」只有三条路：
//   1. 自带音频文件（要自己录或买，包体也会变大）
//   2. 接第三方在线 TTS（要服务器、要费用、有延迟）
//   3. 用「微信同声传译」插件（免费、免服务器、文本直接转语音）
// 这里走第 3 条，并且做成「可选开关」：没启用时所有调用静默返回 false，
// 气泡文字和动作照常工作，不会报错、不会影响演示。
//
// 启用步骤（三步，都在小程序后台 + 本地配置里完成）：
//   1. 小程序后台 → 设置 → 第三方设置 → 插件管理 → 搜索「微信同声传译」→ 添加
//   2. app.json 里增加一段（version 用插件页显示的当前版本号）：
//        "plugins": {
//          "WechatSI": { "version": "0.3.5", "provider": "wx069ba97219f66d99" }
//        }
//   3. 把下面的 ENABLED 改成 true，重新编译
//
// 注意：插件未在后台添加就写进 app.json，小程序会直接编译失败，
// 所以这里默认关闭，代码保持可用。

const ENABLED = false;

let plugin = null;
let audio = null;
let pluginTried = false;
let speaking = false;

function getPlugin() {
  if (!ENABLED) return null;
  if (pluginTried) return plugin;
  pluginTried = true;
  try {
    // 只有 app.json 声明了 WechatSI 插件，这一句才拿得到对象
    plugin = requirePlugin('WechatSI');
  } catch (e) {
    plugin = null;
    console.warn('[voice] 同声传译插件未启用：', e && e.message);
  }
  return plugin;
}

function getAudio() {
  if (audio) return audio;
  audio = wx.createInnerAudioContext();
  audio.obeyMuteSwitch = false; // 静音键下也能出声，宠物叫一声属于提示音
  audio.onEnded(() => { speaking = false; });
  audio.onError(() => { speaking = false; });
  return audio;
}

/**
 * 播报一句话
 * @param {string} text 要念的内容
 * @param {object} opts { force: 正在播报时也打断重播 }
 * @returns {Promise<boolean>} 是否真的播出来了
 */
function speak(text, opts) {
  const options = opts || {};
  if (!ENABLED || !text) return Promise.resolve(false);
  if (speaking && !options.force) return Promise.resolve(false);

  const si = getPlugin();
  if (!si || !si.textToSpeech) return Promise.resolve(false);

  return new Promise((resolve) => {
    si.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content: String(text).slice(0, 120),
      success: (res) => {
        if (!res || !res.filename) {
          resolve(false);
          return;
        }
        try {
          const player = getAudio();
          player.stop();
          player.src = res.filename;
          speaking = true;
          player.play();
          resolve(true);
        } catch (e) {
          speaking = false;
          resolve(false);
        }
      },
      fail: () => {
        speaking = false;
        resolve(false);
      }
    });
  });
}

function stop() {
  speaking = false;
  if (audio) {
    try { audio.stop(); } catch (e) { /* 忽略 */ }
  }
}

function destroy() {
  stop();
  if (audio) {
    try { audio.destroy(); } catch (e) { /* 忽略 */ }
    audio = null;
  }
}

module.exports = { speak, stop, destroy, enabled: ENABLED };
