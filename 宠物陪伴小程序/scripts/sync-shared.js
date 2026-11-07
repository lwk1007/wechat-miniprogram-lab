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
// 新增共享模块时，在 SHARED 里加一行即可。to 支持多个目标：
// 一个模块可能被好几个云函数用到（称呼就是 chat / letter / pet 三个都要）。

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SHARED = [
  {
    name: '称呼解析',
    from: 'miniprogram/utils/title.js',
    to: [
      'cloudfunctions/letter/title.js',
      'cloudfunctions/pet/title.js'
    ]
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

    item.to.forEach((toPath) => {
      let targetContent = null;
      try { targetContent = read(toPath); } catch (e) { targetContent = null; }

      if (check) {
        if (targetContent === src) {
          console.log('✓ ' + item.name + '：' + toPath + ' 与源一致');
        } else {
          console.log('✗ ' + item.name + '：' + toPath + ' 与 ' + item.from + ' 不一致');
          console.log('  执行 node scripts/sync-shared.js 修复');
          bad++;
        }
        return;
      }

      if (targetContent === src) {
        console.log('· ' + item.name + '：' + toPath + ' 已是最新');
        return;
      }
      // 源文件只允许改到这里，副本必须逐字节相同：内容一致才能直接覆盖
      const target = path.join(ROOT, toPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, src, 'utf8');
      console.log('↑ ' + item.name + '：' + item.from + ' → ' + toPath);
    });
  });

  if (bad) process.exit(1);
}

main();
