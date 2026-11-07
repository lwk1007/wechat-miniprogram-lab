// 声音纪念断言（Node 模拟 wx 环境）
// 覆盖：时长/日期格式化、装饰（心情元数据）、新增/列表/删除/清空、录音文件持久化。

const path = require('path');

const ROOT = path.join(__dirname, '..');
const store = new Map();
const removedFiles = [];

global.wx = {
  env: { USER_DATA_PATH: '/mock/user' },
  getStorageSync(k) { return store.has(k) ? store.get(k) : ''; },
  setStorageSync(k, v) { store.set(k, v); },
  removeStorageSync(k) { store.delete(k); },
  clearStorageSync() { store.clear(); },
  getFileSystemManager() {
    return {
      saveFile({ tempFilePath, success, fail }) {
        if (!tempFilePath) { fail && fail({ errMsg: 'no temp' }); return; }
        const saved = '/mock/user/pet_voices/' + Date.now() + '.mp3';
        success && success({ savedFilePath: saved });
      },
      unlink({ filePath, success, fail }) {
        removedFiles.push(filePath);
        success && success();
      }
    };
  }
};

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const vm = require(path.join(ROOT, 'miniprogram/utils/voice-memory'));

(async function run() {
  console.log('\n[1] 纯函数：时长与日期');
  {
    ok('0 毫秒 → 0秒', vm.formatDuration(0) === '0秒');
    ok('45 秒 → 45秒', vm.formatDuration(45000) === '45秒');
    ok('60 秒 → 1:00', vm.formatDuration(60000) === '1:00');
    ok('83 秒 → 1:23', vm.formatDuration(83000) === '1:23');
    ok('负数按 0 处理', vm.formatDuration(-500) === '0秒');
    ok('非法值按 0 处理', vm.formatDuration('abc') === '0秒');

    const d = new Date();
    ok('今年省略年份', vm.fmtDate(d.getTime()) === (d.getMonth() + 1) + '月' + d.getDate() + '日');
    const lastYear = new Date(d.getFullYear() - 1, 5, 15);
    ok('跨年带年份', vm.fmtDate(lastYear.getTime()) === (d.getFullYear() - 1) + '年6月15日');
  }

  console.log('\n[2] 新增与列表');
  {
    store.clear();
    const r = vm.add({ title: '  想你了  ', mood: 'missing', note: '  今天路过它常去的公园  ', duration: 60000, filePath: '/mock/a.mp3' });
    ok('返回记录含 _id', !!r && !!r._id);
    ok('标题去空白', r.title === '想你了');
    ok('备注去空白', r.note === '今天路过它常去的公园');
    ok('时长正确', r.duration === 60000);
    ok('记录创建时间', r.createdAt > 0);

    const longTitle = vm.add({ title: '字'.repeat(30), mood: 'happy', duration: 1000 });
    ok('标题截断到 20', longTitle.title.length === 20);

    const longNote = vm.add({ note: '字'.repeat(200), duration: 1000 });
    ok('备注截断到 120', longNote.note.length === 120);

    const bad = vm.add({ mood: '不存在的情绪', duration: 1000 });
    ok('非法心情归一为空串', bad.mood === '');

    const list = vm.list();
    ok('列表倒序（最新在前）', list.length === 4 && list[0]._id === bad._id);
  }

  console.log('\n[3] 装饰（心情元数据 + 时长文本 + 日期文本）');
  {
    store.clear();
    vm.add({ title: '早安', mood: 'grateful', duration: 83000 });
    const list = vm.list();
    const v = list[0];
    ok('心情 face', v.moodFace === '💗');
    ok('心情 label', v.moodLabel === '感恩');
    ok('时长文本', v.durationText === '1:23');
    ok('日期文本非空', !!v.dateText);
    ok('无心情时 face/label 为空', (() => {
      vm.add({ duration: 1000 });
      const l2 = vm.list();
      return l2[0].moodFace === '' && l2[0].moodLabel === '';
    })());
  }

  console.log('\n[4] 录音文件持久化');
  {
    const res = await vm.persistTemp('/tmp/rec-temp.mp3');
    ok('返回保存路径', !!res && !!res.filePath);

    let threw = false;
    try { await vm.persistTemp(''); } catch (e) { threw = true; }
    ok('空临时路径拒绝', threw);
  }

  console.log('\n[5] 删除与清空（连带删文件）');
  {
    store.clear();
    removedFiles.length = 0;
    const a = vm.add({ title: 'a', duration: 1000, filePath: '/mock/a.mp3' });
    const b = vm.add({ title: 'b', duration: 2000, filePath: '/mock/b.mp3' });

    ok('删除存在的返回 true', vm.remove(a._id) === true);
    ok('删除后列表剩 1 条', vm.list().length === 1);
    ok('删除时连带删文件', removedFiles.indexOf('/mock/a.mp3') >= 0);
    ok('删除不存在的返回 false', vm.remove('nope') === false);

    vm.reset();
    ok('reset 清空列表', vm.list().length === 0);
    ok('reset 连带删剩余文件', removedFiles.indexOf('/mock/b.mp3') >= 0);
  }

  console.log('\n────────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' · 失败 ' + fail);
  if (fail > 0) process.exit(1);
})();
