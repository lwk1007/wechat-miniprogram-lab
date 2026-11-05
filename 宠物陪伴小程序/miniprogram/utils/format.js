// 通用格式化与小工具
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  const date = new Date(ts);
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function greetingByHour() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，早点休息呀';
  if (h < 11) return '早上好呀，今天也要元气满满';
  if (h < 14) return '中午啦，记得好好吃饭哦';
  if (h < 18) return '下午的阳光好舒服，一起晒晒太阳吧';
  if (h < 22) return '晚上好，今天辛苦啦';
  return '晚安，我在这里陪着你';
}

module.exports = { timeAgo, randomFrom, greetingByHour };
