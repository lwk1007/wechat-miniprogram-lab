#!/usr/bin/env node
// 共享文件同步
//
// 小程序的云函数是独立部署包，不能 require 小程序目录下的文件，
// 所以「两端共用同一份逻辑」的模块必须物理复制一份。
// 复制本身没问题，问题是改了一边忘了另一边 —— 这里用脚本 + 测试断言解决。
//
// 用法：
//   node scripts/sync-shared.js          生成/覆盖副本
//   node scripts/sync-shared.js --check  只校验，不一致则退出码 1（供测试用）
//
// 新增共享模块时，在 SHARED 里加一行即可。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SHARED = [
  {
    name: '对话大脑',
    from: 'miniprogram/utils/chat-brain.js',
    to: 'cloudfunctions/chat/chat-brain.js'
  }
];

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function main() {
  const check = process.argv.indexOf('--check') >= 0;
  let bad = 0;

  SHARED.forEach((item) => {
    let src;
    try {
      src = read(item.from);
    } catch (e) {
      console.log('✗ 源文件缺失：' + item.from);
      bad++;
      return;
    }
    const target = path.join(ROOT, item.to);
    let targetContent = null;
    try { targetContent = read(item.to); } catch (e) { targetContent = null; }

    if (check) {
      if (targetContent === src) {
        console.log('✓ ' + item.name + '：' + item.to + ' 与源一致');
      } else {
        console.log('✗ ' + item.name + '：' + item.to + ' 与 ' + item.from + ' 不一致');
        console.log('  执行 node scripts/sync-shared.js 修复');
        bad++;
      }
      return;
    }

    if (targetContent === src) {
      console.log('· ' + item.name + '：已是最新');
      return;
    }
    // 源文件只允许改到这里，副本必须逐字节相同：内容一致才能直接覆盖
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src, 'utf8');
    console.log('↑ ' + item.name + '：' + item.from + ' → ' + item.to);
  });

  if (bad) process.exit(1);
}

main();
