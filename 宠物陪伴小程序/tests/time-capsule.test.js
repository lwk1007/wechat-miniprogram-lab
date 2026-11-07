// 时光胶囊断言（Node 模拟 wx 环境）
// 覆盖：埋胶囊（空内容/现在与过去时间拦截、截断）、倒序列表、解锁判断、倒计时、开启、删除、清空。

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

const tc = require(path.join(ROOT, 'miniprogram/utils/time-capsule'));

const DAY = 86400e3;
const NOW = 1700000000000; // 纯函数用固定「现在」，避免依赖真实时钟

(async function run() {
  console.log('\n[1] 埋胶囊');
  {
    store.clear();
    const now = Date.now();

    let threw = false;
    try { tc.add({ content: '   ', unlockAt: now + DAY }); } catch (e) { threw = true; }
    ok('空内容抛错', threw);

    threw = false;
    try { tc.add({ content: 'hi', unlockAt: now }); } catch (e) { threw = true; }
    ok('此刻不能埋（unlockAt 等于当前抛错）', threw);

    threw = false;
    try { tc.add({ content: 'hi', unlockAt: now - DAY }); } catch (e) { threw = true; }
    ok('过去时间抛错', threw);

    threw = false;
    try { tc.add({ content: 'hi' }); } catch (e) { threw = true; }
    ok('缺 unlockAt 抛错', threw);

    const c = tc.add({ content: '  你好，未来的我。  ', title: '  给一年后  ', unlockAt: now + DAY });
    ok('正常埋入返回胶囊', !!c && !!c._id);
    ok('内容去首尾空白', c.content === '你好，未来的我。');
    ok('标题去空白并截断', c.title === '给一年后');
    ok('默认未开启', c.openedAt === 0);
    ok('记录埋入时间', c.createdAt > 0);
    ok('解锁时间正确', c.unlockAt === now + DAY);

    const long = tc.add({ content: '字'.repeat(600), unlockAt: now + DAY });
    ok('内容截断到 500', long.content.length === 500);

    const longTitle = tc.add({ content: 'x', title: '题'.repeat(30), unlockAt: now + DAY });
    ok('标题截断到 20', longTitle.title.length === 20);
  }

  console.log('\n[2] 列表');
  {
    store.clear();
    const now = Date.now();
    tc.add({ content: '第一颗', unlockAt: now + DAY });
    tc.add({ content: '第二颗', unlockAt: now + 2 * DAY });
    const list = tc.list();
    ok('列表倒序（最新在前）', list[0].content === '第二颗' && list[1].content === '第一颗');
  }

  console.log('\n[3] 解锁判断与倒计时');
  {
    ok('未来未解锁', tc.isUnlocked({ unlockAt: NOW + DAY }, NOW) === false);
    ok('到点即解锁（等于当前）', tc.isUnlocked({ unlockAt: NOW }, NOW) === true);
    ok('过去已解锁', tc.isUnlocked({ unlockAt: NOW - DAY }, NOW) === true);
    ok('无 unlockAt 视为未解锁', tc.isUnlocked({}, NOW) === false);

    ok('倒计时：天', tc.countdownText({ unlockAt: NOW + 3 * DAY }, NOW) === '还有 3 天开启');
    ok('倒计时：小时', tc.countdownText({ unlockAt: NOW + 5 * 3600e3 }, NOW) === '还有 5 小时开启');
    ok('倒计时：分钟', tc.countdownText({ unlockAt: NOW + 30 * 60000 }, NOW) === '还有 30 分钟开启');
    ok('不足 1 分钟按 1 分钟', tc.countdownText({ unlockAt: NOW + 1000 }, NOW) === '还有 1 分钟开启');
    ok('已解锁', tc.countdownText({ unlockAt: NOW - 1 }, NOW) === '已解锁');
  }

  console.log('\n[4] 开启与删除');
  {
    store.clear();
    const now = Date.now();
    const c = tc.add({ content: '秘密', unlockAt: now + DAY });
    ok('开启前 openedAt 为 0', tc.list()[0].openedAt === 0);

    const opened = tc.open(c._id);
    ok('open 返回胶囊', !!opened);
    ok('open 记录 openedAt', opened.openedAt > 0);

    const again = tc.open(c._id);
    ok('重复 open 不覆盖首次开启时间', again.openedAt === opened.openedAt);

    ok('删除存在的胶囊返回 true', tc.remove(c._id) === true);
    ok('删除后列表为空', tc.list().length === 0);
    ok('删除不存在的返回 false', tc.remove('nope') === false);
  }

  console.log('\n[5] 清空');
  {
    tc.add({ content: 'x', unlockAt: Date.now() + DAY });
    tc.reset();
    ok('reset 清空列表', tc.list().length === 0);
  }

  console.log('\n────────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail > 0) process.exit(1);
})();
