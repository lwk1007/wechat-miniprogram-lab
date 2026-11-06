// 把 utils/parallax.js 原样搬进浏览器，生成 tools/parallax-demo.html
//
// 为什么要生成而不是手写一份：视差的好坏全靠 coefficients 和滤波系数，
// 手写第二份必然漂移。这里直接把源文件里的 module.exports 换成 window.PX，
// 页面跑的就是小程序里跑的那套函数，一个数都不差。
//
// 用法：node scripts/build-parallax-demo.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'miniprogram/utils/parallax.js');
const tplPath = path.join(__dirname, 'parallax-demo.tpl.html');
const outPath = path.join(root, 'tools/parallax-demo.html');

let src = fs.readFileSync(srcPath, 'utf8');

// 把 CommonJS 的导出行换成挂到 window 上
const exportLine = /module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/;
if (!exportLine.test(src)) {
  console.error('✗ 没在 parallax.js 里找到 module.exports，导出方式变了？');
  process.exit(1);
}
src = src.replace(exportLine, [
  'window.PX = {',
  '  MAX_UNIT_TILT, SMOOTH_ALPHA, PRESETS,',
  '  clamp, tiltUnit, offsets, smooth, smoothUnit, changed, baseline',
  '};'
].join('\n'));

const tpl = fs.readFileSync(tplPath, 'utf8');
if (tpl.indexOf('/*__PARALLAX__*/') < 0) {
  console.error('✗ 模板里没有 /*__PARALLAX__*/ 占位符');
  process.exit(1);
}

const html = tpl.replace('/*__PARALLAX__*/', src);
fs.writeFileSync(outPath, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('✓ 已生成 tools/parallax-demo.html（' + kb + ' KB）');
console.log('  算法来源：miniprogram/utils/parallax.js');
