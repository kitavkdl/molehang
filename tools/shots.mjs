/**
 * 4개 시간대 스크린샷 + 밝기 자동 검증.
 *
 *   npm run shots
 *
 * dev 서버를 직접 띄우고, 모바일 세로 뷰포트로 낮/노을/밤/새벽을 찍어
 * docs/shots/ 에 저장한다. 화면이 어두우면(§3.4) 종료 코드 1로 실패시킨다.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'shots');
const PORT = 5178;
const BASE = `http://127.0.0.1:${PORT}`;

/** CLAUDE.md §3.4 — 어둡거나 칙칙하면 실패 */
const MIN_MEAN_LUMINANCE = 0.34;

const SHOTS = [
  { name: 'day', phase: 'day', label: '낮', res: '420' },
  { name: 'dusk', phase: 'dusk', label: '노을', res: 'full' },
  { name: 'night', phase: 'night', label: '밤', res: '150' },
  { name: 'dawn', phase: 'dawn', label: '새벽', res: '300' },
];

const VIEWPORT = { width: 390, height: 844 };

/** vite 를 자식 프로세스가 아니라 같은 프로세스에서 띄운다 — 확실하게 정리되도록 */
async function startDevServer() {
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  });
  await server.listen();
  return server;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startDevServer();
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const report = [];
  let failed = false;

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });

    for (const shot of SHOTS) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });

      await page.goto(`${BASE}/?phase=${shot.phase}&res=${shot.res}&probe=1`, {
        waitUntil: 'load',
      });
      await page.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, {
        timeout: 20_000,
      });
      // 파도·구름이 자리를 잡도록 몇 초 흘려보낸다
      await page.waitForTimeout(2500);

      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      const file = path.join(OUT, `${shot.name}.png`);
      await page.screenshot({ path: file });

      const mean = probe?.mean ?? 0;
      const ok = mean >= MIN_MEAN_LUMINANCE && errors.length === 0;
      if (!ok) failed = true;

      report.push({ ...shot, mean, p10: probe?.p10 ?? 0, errors, ok });
      console.log(
        `${ok ? 'OK  ' : 'FAIL'} ${shot.name.padEnd(6)} ${shot.label.padEnd(3)} ` +
          `평균휘도 ${mean.toFixed(3)} (하위10% ${(probe?.p10 ?? 0).toFixed(3)})` +
          (errors.length ? ` — 에러 ${errors.length}건: ${errors[0]}` : ''),
      );
      await page.close();
    }

    // 수거 연출도 한 장 남긴다
    const fx = await context.newPage();
    await fx.goto(`${BASE}/?phase=day&res=full&probe=1`, { waitUntil: 'load' });
    await fx.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 20_000 });
    await fx.waitForTimeout(1500);
    await fx.evaluate(() => window.molehang?.collect());
    await fx.waitForTimeout(240);
    await fx.screenshot({ path: path.join(OUT, 'collect.png') });
    await fx.waitForTimeout(400);
    await fx.click('#open-sheet');
    await fx.waitForTimeout(600);
    await fx.screenshot({ path: path.join(OUT, 'sheet.png') });
    await fx.close();

    await writeFile(
      path.join(OUT, 'report.json'),
      JSON.stringify({ minMeanLuminance: MIN_MEAN_LUMINANCE, shots: report }, null, 2),
      'utf8',
    );
  } finally {
    await browser.close();
    await server.close();
  }

  if (failed) {
    console.error(`\n밝기 기준(${MIN_MEAN_LUMINANCE}) 미달 또는 콘솔 에러가 있습니다.`);
    process.exitCode = 1;
  } else {
    console.log(`\n전부 통과. ${path.relative(ROOT, OUT)} 에 저장했습니다.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
