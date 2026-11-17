'use strict';
const fs = require('node:fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: node test/extract-ui-result.cjs <dump.html>');
  process.exit(2);
}
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('<pre id="testresult"');
if (start < 0) {
  console.error('UI test result not found. The page may have failed before running tests.');
  process.exit(1);
}
const a = html.indexOf('>', start) + 1;
const b = html.indexOf('</pre>', a);
const raw = html.slice(a, b)
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
console.log(raw);
const m = raw.match(/TESTS (\d+)\/(\d+)/);
if (!m) {
  console.error('Could not parse test score.');
  process.exit(1);
}
const passed = Number(m[1]);
const total = Number(m[2]);
console.log('\nUI RESULT ' + passed + '/' + total);
if (!total || passed !== total) {
  console.error('UI tests failed.');
  process.exit(1);
}
if (/ERRS \[[^\]]/.test(raw)) {
  console.error('Uncaught page errors were reported.');
  process.exit(1);
}
process.exit(0);
