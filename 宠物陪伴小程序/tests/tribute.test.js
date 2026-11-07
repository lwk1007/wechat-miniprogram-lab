// 思念信箱断言（Node 模拟 wx 环境）
// 覆盖：写思念信（空内容拦截、截断）、倒序列表、点灯标记、清空。

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

const tribute = require(path.join(ROOT, 'miniprogram/utils/tribute'));

(async function run() {
  console.log('\n[1] 写思念信');
  {
    store.clear();
    // 空内容拦截
    let threw = false;
    try { tribute.add('   '); } catch (e) { threw = true; }
    ok('空内容抛错', threw);

    // 正常写入
    const l = tribute.add('  豆豆，我很想你。  ');
    ok('写入后返回信对象', !!l && l._id);
    ok('内容去除首尾空白', l.content === '豆豆，我很想你。');
    ok('默认未点灯', l.lit === false);
    ok('带时间戳', l.createdAt > 0);

    // 截断 500 字
    const long = tribute.add('字'.repeat(600));
    ok('超长内容截断到 500', long.content.length === 500);
  }

  console.log('\n[2] 列表与点灯');
  {
    store.clear();
    const a = tribute.add('第一封');
    const b = tribute.add('第二封');
    const list = tribute.list();
    ok('列表倒序（最新在前）', list[0].content === '第二封' && list[1].content === '第一封');

    tribute.lightCandle(a._id);
    const after = tribute.list();
    const litA = after.find((t) => t._id === a._id);
    ok('点灯后 lit 为真', litA && litA.lit === true);
    ok('另一封不受影响', after.find((t) => t._id === b._id).lit === false);
    ok('记录最近点灯时间', tribute.lastLitAt() > 0);
  }

  console.log('\n[3] 清空');
  {
    tribute.reset();
    ok('reset 清空列表', tribute.list().length === 0);
    ok('reset 清空点灯时间', tribute.lastLitAt() === 0);
  }

  console.log('\n────────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail > 0) process.exit(1);
})();
