/**
 * 빌드 결과를 **HTML 파일 하나**로 합친다.
 *
 *   npm run build && npm run build:standalone
 *   → dist/molehang-standalone.html
 *
 * 서버 없이 파일을 열기만 해도 돌아가서, 친구에게 그냥 파일로 보내거나
 * 정적 호스팅 아무 데나 올릴 때 쓴다.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
const assets = await readdir(path.join(DIST, 'assets'));

const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (js === undefined || css === undefined) {
  throw new Error('dist/assets 에서 js/css 를 찾지 못했습니다. 먼저 npm run build 를 실행하세요.');
}

const jsCode = await readFile(path.join(DIST, 'assets', js), 'utf8');
const cssCode = await readFile(path.join(DIST, 'assets', css), 'utf8');

const out = html
  .replace(
    new RegExp(`<link[^>]*href="[^"]*${css}"[^>]*>`),
    `<style>\n${cssCode}\n</style>`,
  )
  .replace(
    new RegExp(`<script[^>]*src="[^"]*${js}"[^>]*></script>`),
    // 번들이 ESM 이므로 type="module" 을 유지해야 한다
    `<script type="module">\n${jsCode}\n</script>`,
  );

if (out.includes('assets/')) {
  throw new Error('인라인되지 않은 애셋 참조가 남아 있습니다');
}

const target = path.join(DIST, 'molehang-standalone.html');
await writeFile(target, out, 'utf8');
console.log(
  `${path.relative(ROOT, target)} — ${(Buffer.byteLength(out) / 1024 / 1024).toFixed(2)} MB`,
);
