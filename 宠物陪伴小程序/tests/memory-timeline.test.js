// 回忆时间轴聚合层断言
//
// memory-timeline.js 是纯函数（时间可注入、不碰 wx），
// 所以直接 require 就能测，不用打 Storage 桩。
// 覆盖：相遇节点、里程碑生成与上限、倒序、按天分组、往年今日边界。

const path = require('path');

const ROOT = path.join(__dirname, '..');
const memory = require(path.join(ROOT, 'miniprogram/utils/memory-timeline'));
const together = require(path.join(ROOT, 'miniprogram/utils/together'));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

// 起算日 2026-01-01；now 传确定性时间戳，避免时区/机器时钟干扰
const START = together.parseYmd('2026-01-01');
const pet = { name: '豆豆', sinceDate: '2026-01-01', createdAt: START };

// 把 groups 摊平回事件数组，方便断言
function flatten(groups) {
  return groups.reduce((arr, g) => arr.concat(g.items), []);
}

(async function run() {
  /* ================= 一、相遇节点 ================= */
  console.log('\n[1] build：相遇节点');
  {
    const now = memory.dayTs(START, 3); // 第 3 天
    const { groups } = memory.build({ pet, diary: [], letters: [], now });
    const events = flatten(groups);
    const meet = events.find((e) => e.type === 'meet');
    ok('生成相遇节点', !!meet);
    ok('相遇节点 ts 等于起算日', meet && meet.ts === START);
    ok('相遇节点是第 1 天', meet && meet.day === 1);
    ok('相遇文案带宠物名', meet && meet.text.indexOf('豆豆') >= 0);
    // 第 3 天还没到第 7 天里程碑，所以只有相遇一个事件
    ok('第 3 天没有里程碑', events.length === 1, 'events=' + events.length);
  }

  /* ================= 二、里程碑 ================= */
  console.log('\n[2] build：里程碑生成与上限');
  {
    const now = memory.dayTs(START, 30); // 第 30 天
    const { groups } = memory.build({ pet, diary: [], letters: [], now });
    const events = flatten(groups);
    const milestones = events.filter((e) => e.type === 'milestone');
    // MILESTONES 里 <=30 且 >1 的：7、14、30
    ok('第 30 天有 3 个里程碑', milestones.length === 3, 'milestones=' + milestones.length);
    ok('第 7 天里程碑存在', milestones.some((m) => m.day === 7));
    ok('第 30 天里程碑存在', milestones.some((m) => m.day === 30));
    ok('第 60 天里程碑还没出现', !milestones.some((m) => m.day === 60));
    // 里程碑 ts 计算：第 7 天 = start + 6 天
    const d7 = milestones.find((m) => m.day === 7);
    ok('第 7 天里程碑日期正确', d7 && d7.ts === memory.dayTs(START, 7));
    // 事件总数 = 相遇 + 3 里程碑
    ok('第 30 天事件总数正确', events.length === 4, 'events=' + events.length);
  }

  /* ================= 三、倒序与分组 ================= */
  console.log('\n[3] build：倒序 + 按天分组');
  {
    const now = memory.dayTs(START, 30);
    // 日记：一条在第 30 天，一条在第 5 天
    const diary = [
      { createdAt: memory.dayTs(START, 30), text: '今天的足迹', emoji: '🐾' },
      { createdAt: memory.dayTs(START, 5), text: '早年的足迹', emoji: '🐾' }
    ];
    // 信件：一封在第 30 天（和日记同一天）
    const letters = [
      { createdAt: memory.dayTs(START, 30), content: '你好' }
    ];
    const { groups } = memory.build({ pet, diary, letters, now });
    const events = flatten(groups);
    // 倒序：最新的（第 30 天）在最前
    ok('最新事件在最前', events[0].ts === memory.dayTs(START, 30));
    ok('最旧事件在最后', events[events.length - 1].ts === START);
    // 第 30 天有 3 个事件：日记 + 信件 + 里程碑30
    const day30 = groups[0];
    ok('第 30 天归为一组', day30.items.length === 3, 'items=' + day30.items.length);
    ok('同一天的日记和信件在同一组', day30.items.some((e) => e.type === 'diary') && day30.items.some((e) => e.type === 'letter'));
    // 分组总数：第30天 + 第14天 + 第7天 + 第5天(日记) + 第1天(相遇) = 5 组
    ok('分组数量正确', groups.length === 5, 'groups=' + groups.length);
    // 组头带第 N 天标记
    ok('组头带第 N 天标记', day30.dayText === '第 30 天', day30.dayText);
  }

  /* ================= 四、往年今日 ================= */
  console.log('\n[4] onThisDay：往年今日边界');
  {
    // 不满一年 → null
    const early = memory.onThisDay({ pet, diary: [], letters: [], now: memory.dayTs(START, 100) });
    ok('不满一年返回 null', early === null);

    // 满一年：第 400 天 → 去年今日 = 第 35 天
    const now = memory.dayTs(START, 400);
    const diary = [{ createdAt: memory.dayTs(START, 35), text: '去年今天的足迹', emoji: '🐾' }];
    const otd = memory.onThisDay({ pet, diary, letters: [], now });
    ok('满一年返回对象', !!otd);
    ok('thatDay 正确', otd && otd.thatDay === 35, otd && otd.thatDay);
    ok('那天有记录则 hasRecord 为真', otd && otd.hasRecord === true);
    ok('命中的日记被收集', otd && otd.items.some((i) => i.text === '去年今天的足迹'));

    // 那天没记录 → hasRecord false
    const empty = memory.onThisDay({ pet, diary: [], letters: [], now });
    ok('那天没记录则 hasRecord 为假', empty && empty.hasRecord === false);

    // 第 365 天当天：去年今日 = 第 0 天，不该返回
    const exactly = memory.onThisDay({ pet, diary: [], letters: [], now: memory.dayTs(START, 365) });
    ok('第 365 天当天返回 null', exactly === null);
  }

  /* ================= 五、工具函数 ================= */
  console.log('\n[5] 工具函数');
  {
    ok('milestoneText 已知档位', memory.milestoneText(30) === '满一个月啦');
    ok('milestoneText 兜底', memory.milestoneText(200) === '第 200 天');
    ok('dayTs 第 1 天 = start', memory.dayTs(START, 1) === START);
    ok('dayTs 第 2 天 = start + 1 天', memory.dayTs(START, 2) === START + 86400e3);
    ok('typeIcon 四类', memory.typeIcon('meet') === '🏠' && memory.typeIcon('milestone') === '🎉' && memory.typeIcon('diary') === '🐾' && memory.typeIcon('letter') === '💌');
  }

  console.log('\n────────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail > 0) process.exit(1);
})();
