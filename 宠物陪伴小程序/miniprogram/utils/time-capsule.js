// 时光胶囊：写给未来的信，定时解锁
//
// 借鉴：
//   · Agha-Here/TimeCapsule —— 未来解锁系统（锁定期间内容不可见）
//   · ShotgunSurgery/time_capsule —— 倒计时解锁 + 离线本地优先
//   · hadrylouis/msg2future —— 「时间锁」概念（到点才能开启）
//
// 与「思念信箱」（当下写给它）形成对照：思念信是即时寄出，
// 时光胶囊是写给未来——给未来的自己留一句话，也给「未来的它」留一个约定。
// 锁定期间连自己都看不了，只有时间到了才打开，守住那份「等待」的重量。
//
// 私密记忆只存本机，不上传。数据只在本机 Storage。

const KEY = 'pet_time_capsules';
const KEEP = 50;
const MAX_CONTENT = 500;
const MAX_TITLE = 20;

// 同一毫秒内连埋多颗时，仅用 Date.now() 会撞 ID，加自增序号兜底
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

// 纯函数：是否已到解锁时间
function isUnlocked(c, now) {
  return !!c && !!c.unlockAt && c.unlockAt <= (now || Date.now());
}

// 纯函数：倒计时描述。锁定期间给「还有 X 天/小时/分钟开启」
function countdownText(c, now) {
  const t = now || Date.now();
  if (!c || !c.unlockAt) return '';
  const diff = c.unlockAt - t;
  if (diff <= 0) return '已解锁';
  const days = Math.floor(diff / 86400e3);
  if (days > 0) return '还有 ' + days + ' 天开启';
  const hours = Math.floor(diff / 3600e3);
  if (hours > 0) return '还有 ' + hours + ' 小时开启';
  const mins = Math.max(1, Math.floor(diff / 60000));
  return '还有 ' + mins + ' 分钟开启';
}

// 全部胶囊（最新埋下的在前）
function list() {
  return read();
}

// 埋一颗胶囊。unlockAt 必须是未来时间，否则拒绝
function add({ content, title, unlockAt } = {}) {
  const text = String(content == null ? '' : content).trim();
  if (!text) throw new Error('写下想对未来说的话吧');
  const at = Number(unlockAt) || 0;
  if (!at) throw new Error('请选一个开启的日期');
  if (at <= Date.now()) throw new Error('开启日期得是未来的一天');
  const capsule = {
    _id: 'c' + Date.now() + '-' + (seq++),
    title: String(title == null ? '' : title).trim().slice(0, MAX_TITLE),
    content: text.slice(0, MAX_CONTENT),
    unlockAt: at,
    createdAt: Date.now(),
    openedAt: 0 // 0 = 还没开启；>0 = 已经开启过
  };
  const arr = read();
  arr.unshift(capsule);
  write(arr);
  return capsule;
}

// 开启：解锁后第一次打开时记录时间，之后再次打开不再覆盖
function open(id) {
  const arr = read();
  const item = arr.find((c) => c._id === id);
  if (!item) return null;
  if (!item.openedAt) {
    item.openedAt = Date.now();
    write(arr);
  }
  return item;
}

// 删除一颗胶囊（不管有没有解锁，都可以删掉重新埋）
function remove(id) {
  const arr = read();
  const next = arr.filter((c) => c._id !== id);
  write(next);
  return next.length !== arr.length;
}

function reset() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* ignore */ }
}

module.exports = {
  list, add, open, remove, reset,
  isUnlocked, countdownText,
  MAX_CONTENT, MAX_TITLE
};
