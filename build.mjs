import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const template = read('src/template.html');
const style = read('src/style.css');
const core = read('src/comfy-meta.cjs');
const app = [
  read('src/app.js'),
  read('src/app-workflow.js'),
  read('src/app-raw.js'),
  read('src/app-finish.js')
].join('\n');

const combined = app;
for (const [name, text] of [['core', core], ['app', combined]]) {
  if (text.includes('</script')) {
    throw new Error(name + ' contains </script>');
  }
}

const out = template
  .replace('/*__STYLE__*/', () => style)
  .replace('/*__CORE__*/', () => core)
  .replace('/*__APP__*/', () => combined);

const htmlPath = path.join(root, 'comfyui-params.html');
const buildDir = path.join(root, 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(htmlPath, out, 'utf8');
fs.writeFileSync(path.join(buildDir, 'app.concat.js'), combined, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('built', htmlPath);
console.log('html', kb(Buffer.byteLength(out)), '| css', kb(Buffer.byteLength(style)), '| core', kb(Buffer.byteLength(core)), '| app', kb(Buffer.byteLength(combined)));
