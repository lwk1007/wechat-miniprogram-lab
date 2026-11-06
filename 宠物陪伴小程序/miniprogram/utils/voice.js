// 语音能力（#4 语音对话）
//
// 两条链路都依赖「微信同声传译」插件，这是唯一免费、免服务器的小程序语音方案：
//   1. 语音输入 ASR：plugin.getRecordRecognitionManager()，按下录音、松手出文字
//   2. 语音输出 TTS：plugin.textToSpeech()，文本转音频再用 InnerAudioContext 播放
//
// 设计原则：插件没启用时全部静默降级。麦克风按钮照常显示，点了会告诉用户怎么开，
// 打字聊天完全不受影响。这样功能「看得见、解释得清」，而不是藏起来让人以为没做。
//
// 启用三步（缺一不可）：
//   1. 小程序后台 → 设置 → 第三方设置 → 插件管理 → 搜「微信同声传译」→ 添加
//   2. app.json 增加：
//        "plugins": { "WechatSI": { "version": "0.3.5", "provider": "wx069ba97219f66d99" } }
//   3. 把下面的 ENABLED 改成 true，重新编译
//
// 注意：插件没在后台添加就写进 app.json，小程序会直接编译失败，所以默认关闭。

const ENABLED = false;

const RECOGNIZE_LANG = 'zh_CN';     // 可选 zh_CN / en_US / zh_HK / sichuanhua
const RECOGNIZE_DURATION = 60000;   // 单次录音上限，插件要求传
const TTS_MAX_CHARS = 120;          // 单次播报字数上限，太长听起来像播报器
const TTS_AUTO_KEY = 'pet_tts_auto'; // 自动播报开关的本地存储键

let plugin = null;
let pluginTried = false;
let audio = null;
let speaking = false;
let recognizer = null;   // 当前页持有的识别器，离开页面必须释放

function getPlugin() {
  if (!ENABLED) return null;
  if (pluginTried) return plugin;
  pluginTried = true;
  try {
    // 只有 app.json 声明了 WechatSI，这一句才拿得到对象
    plugin = requirePlugin('WechatSI');
  } catch (e) {
    plugin = null;
    console.warn('[voice] 同声传译插件未启用：', e && e.message);
  }
  return plugin;
}

// 给 UI 用：决定麦克风按钮要不要置灰、点击提示什么
function status() {
  if (!ENABLED) return 'disabled';
  const si = getPlugin();
  if (!si) return 'error';
  return 'ok';
}

function unavailableTip() {
  return status() === 'disabled'
    ? '语音功能还没启用：需要在小程序后台添加「微信同声传译」插件'
    : '语音插件加载失败，请重新编译或检查插件配置';
}

// ---------- 语音输出 TTS ----------

function getAudio() {
  if (audio) return audio;
  audio = wx.createInnerAudioContext();
  audio.obeyMuteSwitch = false; // 静音键下也能出声，宠物叫一声属于提示音
  audio.onEnded(() => { speaking = false; });
  audio.onError(() => { speaking = false; });
  return audio;
}

function isAutoTts() {
  try {
    return wx.getStorageSync(TTS_AUTO_KEY) === true;
  } catch (e) {
    return false;
  }
}

function setAutoTts(on) {
  try {
    wx.setStorageSync(TTS_AUTO_KEY, !!on);
  } catch (e) {
    // 存储失败不影响本次会话，只是下次进来要重新开
  }
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
      content: String(text).slice(0, TTS_MAX_CHARS),
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

function isSpeaking() {
  return speaking;
}

function stop() {
  speaking = false;
  if (audio) {
    try { audio.stop(); } catch (e) { /* 忽略 */ }
  }
}

// ---------- 语音输入 ASR ----------

// 录音权限：初次会弹系统授权框；之前明确拒绝过则只能引导去设置页
// 返回值：true / 'denied' / 'unknown'
function ensureRecordPermission() {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined') return resolve('unknown');
    wx.getSetting({
      success: (res) => {
        const auth = (res && res.authSetting) || {};
        if (auth['scope.record'] === true) return resolve(true);
        if (auth['scope.record'] === false) return resolve('denied');
        wx.authorize({
          scope: 'scope.record',
          success: () => resolve(true),
          fail: () => resolve('denied')
        });
      },
      fail: () => resolve('unknown')
    });
  });
}

/**
 * 创建一个语音识别器。页面 onLoad 里建，onUnload 里 destroy。
 * 插件的 manager 是全局单例，回调会被后注册的覆盖，所以同一时间只应存在一个识别器。
 * @param {object} handlers { onPartial(text), onStop(text, res), onError(res) }
 * @returns {object|null} { start, stop, destroy }
 */
function createRecognizer(handlers) {
  const si = getPlugin();
  if (!si || typeof si.getRecordRecognitionManager !== 'function') return null;

  const mgr = si.getRecordRecognitionManager();
  const h = handlers || {};

  // 有新的中间识别结果，用于边录边显示
  mgr.onRecognize = (res) => {
    if (h.onPartial) h.onPartial((res && res.result) || '');
  };
  // 录音结束（或达到时长上限）
  mgr.onStop = (res) => {
    const text = (res && res.result) || '';
    if (h.onStop) h.onStop(text, res);
  };
  mgr.onError = (res) => {
    if (h.onError) h.onError(res);
  };

  const handle = {
    start() {
      try {
        // 必须在页面渲染完成后调用，否则部分基础库会报错
        mgr.start({ lang: RECOGNIZE_LANG, duration: RECOGNIZE_DURATION });
        return true;
      } catch (e) {
        if (h.onError) h.onError(e);
        return false;
      }
    },
    stop() {
      try { mgr.stop(); } catch (e) { /* 已经停了 */ }
    },
    destroy() {
      // 摘掉回调，避免页面销毁后仍然被触发
      try {
        mgr.onRecognize = null;
        mgr.onStop = null;
        mgr.onError = null;
      } catch (e) { /* 忽略 */ }
      if (recognizer === handle) recognizer = null;
    }
  };

  recognizer = handle;
  return handle;
}

function destroy() {
  stop();
  if (recognizer) {
    recognizer.destroy();
    recognizer = null;
  }
  if (audio) {
    try { audio.destroy(); } catch (e) { /* 忽略 */ }
    audio = null;
  }
}

module.exports = {
  status,
  unavailableTip,
  // TTS
  speak,
  stop,
  isSpeaking,
  isAutoTts,
  setAutoTts,
  // ASR
  ensureRecordPermission,
  createRecognizer,
  destroy,
  enabled: ENABLED
};
