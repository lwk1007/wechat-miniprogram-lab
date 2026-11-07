// 「回忆时间轴」聚合层
//
// 把散落在各处的记忆拼成一条时间线：
//   相遇那天（第 1 天）
//   里程碑（第 7/14/30/.../1825 天）
//   足迹日记（它自己过日子留下的痕迹）
//   来信（它写给你的信）
//
// 全是纯函数，时间可注入，测试不用打桩。
// 数据来源：together.js（第 N 天 / 里程碑）、pet-life.js（日记）、letters（信件）。

const together = require('./together');

// 里程碑文案：从第 7 天开始（第 1 天是「相遇」，单独一个节点）
const MILESTONE_TEXT = {
  7: '一起走过第一周',
  14: '两周的陪伴',
  30: '满一个月啦',
  60: '两个月了',
  100: '第一百天',
  180: '半年啦',
  365: '整整一年',
  500: '五百天',
  730: '两年啦',
  1000: '一千天',
  1825: '五年了'
};

function milestoneText(n) {
  return MILESTONE_TEXT[n] || ('第 ' + n + ' 天');
}

// 第 N 天对应的日期（第 1 天 = 起算日当天）
function dayTs(start, n) {
  return start + (n - 1) * 86400e3;
}

// 事件图标
function typeIcon(type) {
  if (type === 'meet') return '🏠';
  if (type === 'milestone') return '🎉';
  if (type === 'diary') return '🐾';
  if (type === 'letter') return '💌';   // 它写给你的信
  if (type === 'tribute') return '🕯️';  // 你写给它的思念信
  return '•';
}

// 组装完整时间轴（倒序，最新在前），并按天分组
function build({ pet, diary, letters, tributes, now }) {
  const t = now == null ? Date.now() : now;
  const start = together.startAt(pet || {});
  const days = together.daysTogether(pet || {}, t);
  const events = [];

  // 相遇（第 1 天）
  if (start) {
    events.push({
      type: 'meet',
      ts: start,
      day: 1,
      text: '和「' + ((pet && pet.name) || '它') + '」相遇的那天',
      icon: typeIcon('meet')
    });
  }

  // 里程碑（第 1 天已由「相遇」表达，从 7 开始）
  if (start) {
    together.MILESTONES.forEach((n) => {
      if (n > 1 && n <= days) {
        events.push({
          type: 'milestone',
          ts: dayTs(start, n),
          day: n,
          text: milestoneText(n),
          icon: typeIcon('milestone')
        });
      }
    });
  }

  // 足迹日记
  (diary || []).forEach((d) => {
    if (!d || !d.createdAt) return;
    events.push({
      type: 'diary',
      ts: d.createdAt,
      day: 0,
      text: d.text || '',
      emoji: d.emoji || '🐾'
    });
  });

  // 来信
  (letters || []).forEach((l) => {
    if (!l || !l.createdAt) return;
    events.push({
      type: 'letter',
      ts: l.createdAt,
      day: 0,
      text: '给你写了一封信',
      icon: typeIcon('letter')
    });
  });

  // 思念信（你写给它的，与来信形成对话）
  (tributes || []).forEach((t) => {
    if (!t || !t.createdAt) return;
    events.push({
      type: 'tribute',
      ts: t.createdAt,
      day: 0,
      text: '你给它写了一封思念信' + (t.lit ? '，点亮了一盏灯' : ''),
      icon: typeIcon('tribute')
    });
  });

  // 按时间倒序
  events.sort((a, b) => b.ts - a.ts);
  // 给每个事件一个稳定 key（同一天同类事件用序号区分），供 wx:for 使用
  events.forEach((e, i) => { e.key = e.type + '-' + e.ts + '-' + i; });

  // 按天分组：同一天的事件归到一组，组头显示日期 + 第 N 天
  const groups = [];
  events.forEach((e) => {
    const d = new Date(e.ts);
    const key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) {
      const dayN = start ? together.daysTogether(pet || {}, e.ts) : 0;
      groups.push({
        key,
        dateText: together.fmtDate(e.ts),
        dayText: dayN > 0 ? ('第 ' + dayN + ' 天') : '',
        items: []
      });
    }
    groups[groups.length - 1].items.push(e);
  });

  return { start, days, groups };
}

// 往年今日：陪伴满一年后，回看「去年的今天」附近发生了什么
function onThisDay({ pet, diary, letters, tributes, now }) {
  const t = now == null ? Date.now() : now;
  const start = together.startAt(pet || {});
  const days = together.daysTogether(pet || {}, t);
  const lastYearDay = days - 365;
  if (!start || lastYearDay < 1) return null;

  const target = dayTs(start, lastYearDay);
  const items = [];

  // 那天命中的里程碑
  together.MILESTONES.forEach((n) => {
    if (n <= days && Math.abs(dayTs(start, n) - target) < 12 * 3600e3) {
      items.push({ type: 'milestone', text: milestoneText(n), icon: '🎉' });
    }
  });
  // 那天的日记
  (diary || []).forEach((d) => {
    if (d && d.createdAt && Math.abs(d.createdAt - target) < 12 * 3600e3) {
      items.push({ type: 'diary', text: d.text, emoji: d.emoji || '🐾' });
    }
  });
  // 那天的信
  (letters || []).forEach((l) => {
    if (l && l.createdAt && Math.abs(l.createdAt - target) < 12 * 3600e3) {
      items.push({ type: 'letter', text: '给你写了一封信', icon: '💌' });
    }
  });
  // 那天的思念信
  (tributes || []).forEach((t) => {
    if (t && t.createdAt && Math.abs(t.createdAt - target) < 12 * 3600e3) {
      items.push({ type: 'tribute', text: '你给它写了一封思念信', icon: '🕯️' });
    }
  });

  items.slice(0, 5).forEach((it, i) => { it.key = it.type + '-' + i; });

  return {
    thatDay: lastYearDay,
    dateText: together.fmtDate(target),
    hasRecord: items.length > 0,
    items: items.slice(0, 5)
  };
}

module.exports = { build, onThisDay, milestoneText, dayTs, typeIcon };
