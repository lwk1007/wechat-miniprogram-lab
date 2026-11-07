// 心情日志断言（Node 模拟 wx 环境）
// 覆盖：安抚文案、低落判定、月历网格（周一开头）、统计、按天记录与覆盖。

const path = require('path');

const ROOT = path.join(__dirname, '..');
const store = new Map();

global.wx = {
  getStorageSync(k) { return store.has(k) ? store.get(k) : ''; },
  setStorageSync(k, v) { store.set(k, v); },
  removeStorageSync(k) { store.delete(k); },
  clearStorageSync() { store.clear(); }
};

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const moodLog = require(path.join(ROOT, 'miniprogram/utils/mood-log'));

(async function run() {
  /* ================= 一、安抚文案与低落判定 ================= */
  console.log('\n[1] 安抚文案与低落判定');
  ok('想念有安抚文案', moodLog.sootheText('missing').length > 0);
  ok('难过有安抚文案', moodLog.sootheText('sad').length > 0);
  ok('未知心情兜底到平静文案', moodLog.sootheText('???') === moodLog.sootheText('calm'));
  ok('想念判定为低落', moodLog.needsSoothing('missing') === true);
  ok('难过判定为低落', moodLog.needsSoothing('sad') === true);
  ok('开心不判定为低落', moodLog.needsSoothing('happy') === false);
  ok('感恩不判定为低落', moodLog.needsSoothing('grateful') === false);

  /* ================= 二、月历网格 ================= */
  console.log('\n[2] monthCells：月历网格');
  {
    const log = {
      '2026-01-15': { mood: 'happy', note: '想起它', createdAt: Date.now() }
    };
    const now = new Date(2026, 0, 15, 12, 0, 0).getTime(); // 2026-01-15 中午
    const cells = moodLog.monthCells(2026, 1, log, now);

    const first = new Date(2026, 0, 1);
    const expectedLead = (first.getDay() + 6) % 7; // 周一开头
    const leadCount = cells.filter((c) => c.blank).length;
    ok('前置空位数量 = 周一开头偏移', leadCount === expectedLead, 'lead=' + leadCount);

    const total = cells.length;
    ok('总格数 = 前置空位 + 31 天', total === expectedLead + 31, 'total=' + total);

    const day15 = cells.find((c) => c.day === 15);
    ok('第 15 天带心情', day15 && day15.mood === 'happy');
    ok('第 15 天带表情', day15 && day15.face === '😊');
    ok('第 15 天带颜色', day15 && day15.color.length > 0);
    ok('第 15 天是今天', day15 && day15.isToday === true);

    const day1 = cells.find((c) => c.day === 1);
    ok('第 1 天没有心情', day1 && day1.mood === '' && day1.isToday === false);
  }

  /* ================= 三、统计 ================= */
  console.log('\n[3] buildSummary：统计');
  {
    const log = {
      '2026-01-01': { mood: 'happy', createdAt: 1 },
      '2026-01-02': { mood: 'missing', createdAt: 2 },
      '2026-01-03': { mood: 'missing', createdAt: 3 }
    };
    const s = moodLog.buildSummary(log);
    ok('统计天数', s.days === 3, 'days=' + s.days);
    ok('开心计数', s.counts.happy === 1);
    ok('想念计数', s.counts.missing === 2);
    ok('最近一次心情是想念', s.lastMood === 'missing');
    ok('最近时间戳正确', s.lastAt === 3);
  }

  /* ================= 四、存储层：按天记录与覆盖 ================= */
  console.log('\n[4] 存储层：记录、覆盖、清空');
  {
    store.clear();
    const now = new Date(2026, 0, 10, 9, 0, 0).getTime();
    moodLog.setToday('happy', '今天很开心', now);
    const t = moodLog.getToday(now);
    ok('写入后可读到', !!t && t.mood === 'happy' && t.note === '今天很开心');

    // 同一天覆盖
    moodLog.setToday('sad', '又难过了', now);
    const t2 = moodLog.getToday(now);
    ok('同一天覆盖', t2.mood === 'sad' && t2.note === '又难过了');

    // 无效心情不写入
    const before = moodLog.getLog();
    moodLog.setToday('不存在的心情', '', now);
    ok('无效心情不写入', Object.keys(moodLog.getLog()).length === Object.keys(before).length);

    // recent 倒序
    const now2 = new Date(2026, 0, 12, 9, 0, 0).getTime();
    moodLog.setToday('calm', '', now2);
    const recent = moodLog.recent(5, now2);
    ok('recent 返回最近记录', recent.length >= 2);
    ok('recent 最新在前', recent[0].mood === 'calm');

    // reset
    moodLog.reset();
    ok('reset 清空', Object.keys(moodLog.getLog()).length === 0);
  }

  console.log('\n────────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail > 0) process.exit(1);
})();
