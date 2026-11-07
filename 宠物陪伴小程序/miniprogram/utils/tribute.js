// 思念信箱：你写给它的信 + 点灯仪式
//
// 借鉴：
//   · cyberpet——告别仪式（Farewell Ceremony）+ 纪念页（Memorial Page）
//   · smriti——蜡烛火焰的「圣所」美学，安静、无通知无社交
//   · siempre——伦理边界：AI 不替逝者编造话语（思念信是你自己写的，天然符合）
//
// 与「一封信」（它写给你、AI 生成）形成对话：它来信、你回信，
// 时间轴把这种对话感串起来。私密记忆只存本机，不上传。
//
// 数据只在本机 Storage。

const KEY = 'pet_tributes';
const CANDLE_KEY = 'pet_candle';
const KEEP = 50;

// 同一毫秒内连写多封时，仅用 Date.now() 会撞 ID，加个自增序号兜底
let seq = 0;

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

// 全部思念信（最新在前）
function list() {
  return read();
}

// 写一封思念信，返回信对象
function add(content) {
  const text = String(content == null ? '' : content).trim();
  if (!text) throw new Error('想说点什么，再寄给它吧');
  const letter = {
    _id: 't' + Date.now() + '-' + (seq++),
    content: text.slice(0, 500),
    lit: false,
    createdAt: Date.now()
  };
  const arr = read();
  arr.unshift(letter);
  write(arr);
  return letter;
}

// 点灯：写信后点亮一盏灯（记录最近一次点灯时间）
function lightCandle(id) {
  const arr = read();
  const item = arr.find((t) => t._id === id);
  if (item) {
    item.lit = true;
    write(arr);
  }
  try { wx.setStorageSync(CANDLE_KEY, Date.now()); } catch (e) { /* ignore */ }
  return item || null;
}

function lastLitAt() {
  try { return Number(wx.getStorageSync(CANDLE_KEY)) || 0; } catch (e) { return 0; }
}

function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* ignore */ }
  try { wx.removeStorageSync(CANDLE_KEY); } catch (e) { /* ignore */ }
}

module.exports = { add, list, lightCandle, lastLitAt, reset };
