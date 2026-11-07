// 声音纪念：录下想对它说的话，留住它真实的声音
//
// 借鉴：
//   · EchoVault（ShamikDas-Dev）—— 伦理边界：保留真人真实说过的话，
//     AI 只负责整理、不替本人编造新话语。这正是我们要守的线。
//   · FlowDiary（38★）—— 音频日记按心情分组、录音可视化、按天分组。
//   · xiangyuecn/Recorder（5.6k★）—— 小程序端录音能力（我们用原生
//     RecorderManager 更稳，不引第三方依赖）。
//
// 伦理边界：这里保存的是「你」真实录下的声音，不是 AI 合成/克隆的声音。
// 与「不冒充宠物意识」的立场一致——声音是记忆的存档，不是替它说话。
//
// 私密记忆只存本机：元数据在本机 Storage，音频文件在本机用户目录
// （wx.env.USER_DATA_PATH，经 saveFile 持久化），不上传云端。

const moodLog = require('./mood-log');

const KEY = 'pet_voices';
const KEEP = 50;
const MAX_TITLE = 20;
const MAX_NOTE = 120;

// 同一毫秒内连存多条时，仅用 Date.now() 会撞 ID，加自增序号兜底
let seq = 0;

// ---------- 纯函数 ----------

// 时长格式化：毫秒 → 「1:23」或「45秒」
function formatDuration(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m > 0) return m + ':' + (r < 10 ? '0' : '') + r;
  return r + '秒';
}

// 日期文本：今年的省略年份
function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  if (d.getFullYear() === now.getFullYear()) return mm + '月' + dd + '日';
  return d.getFullYear() + '年' + mm + '月' + dd + '日';
}

// 心情元数据（复用心情日志的标签体系，全 App 一致）
function moodMeta(mood) {
  return moodLog.MOODS[mood] || null;
}

// 把原始记录装饰成列表可渲染的形态（时长文本、心情 face/label、日期文本）
function decorate(list) {
  return (list || []).map((v) => {
    const meta = moodMeta(v.mood);
    return Object.assign({}, v, {
      durationText: formatDuration(v.duration),
      moodFace: meta ? meta.face : '',
      moodLabel: meta ? meta.label : '',
      dateText: fmtDate(v.createdAt)
    });
  });
}

// ---------- 存储层 ----------

function read() {
  try {
    const v = wx.getStorageSync(KEY);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function write(list) {
  try { wx.setStorageSync(KEY, list.slice(0, KEEP)); } catch (e) { /* ignore */ }
}

// 全部声音（最新在前，已装饰）
function list() {
  return decorate(read());
}

// 保存录音：临时文件 → 本机用户目录持久化，返回 { filePath }
function persistTemp(tempFilePath) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    fs.saveFile({
      tempFilePath,
      success: (res) => resolve({ filePath: res.savedFilePath }),
      fail: (err) => reject(new Error((err && err.errMsg) || '保存录音失败'))
    });
  });
}

// 新增一条声音记录（filePath 由 persistTemp 得到）
function add({ title, mood, note, duration, filePath } = {}) {
  const rec = {
    _id: 'v' + Date.now() + '-' + (seq++),
    title: String(title == null ? '' : title).trim().slice(0, MAX_TITLE),
    mood: moodLog.MOOD_KEYS.indexOf(mood) >= 0 ? mood : '',
    note: String(note == null ? '' : note).trim().slice(0, MAX_NOTE),
    duration: Number(duration) || 0,
    filePath: String(filePath || ''),
    createdAt: Date.now()
  };
  const arr = read();
  arr.unshift(rec);
  write(arr);
  return rec;
}

// 删除一条声音：元数据 + 本机音频文件一起删
function remove(id) {
  const arr = read();
  const item = arr.find((v) => v._id === id);
  if (!item) return false;
  if (item.filePath) {
    try {
      const fs = wx.getFileSystemManager();
      fs.unlink({ filePath: item.filePath, success: () => {}, fail: () => {} });
    } catch (e) { /* ignore */ }
  }
  write(arr.filter((v) => v._id !== id));
  return true;
}

// 清空：元数据 + 所有音频文件
function reset() {
  const arr = read();
  if (arr.length) {
    try {
      const fs = wx.getFileSystemManager();
      arr.forEach((v) => {
        if (v.filePath) fs.unlink({ filePath: v.filePath, success: () => {}, fail: () => {} });
      });
    } catch (e) { /* ignore */ }
  }
  try { wx.removeStorageSync(KEY); } catch (e) { /* ignore */ }
}

module.exports = {
  list, add, remove, reset, persistTemp,
  formatDuration, fmtDate, moodMeta, decorate,
  MAX_TITLE, MAX_NOTE
};
