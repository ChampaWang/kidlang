#!/usr/bin/env node
/**
 * 生成自包含的单文件版（把 interpreter.js 内联进 index.html）
 *
 * 用法：node build/build-single.js
 * 产物：build/dist/小逻辑.html
 *
 * 这个文件可以直接发给别人，双击用浏览器打开即可。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IN_HTML = path.join(ROOT, 'index.html');
const IN_JS = path.join(ROOT, 'interpreter.js');
const OUT_DIR = path.join(__dirname, 'dist');
const OUT_HTML = path.join(OUT_DIR, '小逻辑.html');

const TAG = '<script src="interpreter.js"></script>';

function main() {
  if (!fs.existsSync(IN_HTML) || !fs.existsSync(IN_JS)) {
    console.error('找不到 index.html 或 interpreter.js');
    process.exit(1);
  }

  let html = fs.readFileSync(IN_HTML, 'utf8');
  const js = fs.readFileSync(IN_JS, 'utf8');

  if (!html.includes(TAG)) {
    console.error('index.html 里没找到 ' + TAG + '，无法内联');
    process.exit(1);
  }

  html = html.replace(TAG, '<script>\n' + js + '\n</script>');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
  console.log('完成：' + OUT_HTML + '（' + kb + ' KB）');
}

main();
