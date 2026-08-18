/**
 * 스크린샷 + 밝기 자동 검증.
 *
 *   npm run shots
 *
 * 모바일 세로 4개 시간대, PC 가로 2개, 그리고 튜토리얼·수거·시트·괴상한 배까지
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

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const PHASE_SHOTS = [
  { name: 'day', phase: 'day', label: '낮', res: '420', parts: 'window*3,sail,barrel' },
  { name: 'dusk', phase: 'dusk', label: '노을', res: 'full', parts: 'engine*2,chimney*2,lantern*2' },
  { name: 'night', phase: 'night', label: '밤', res: '150', parts: 'lantern*5,window*4' },
  { name: 'dawn', phase: 'dawn', label: '새벽', res: '300', parts: 'moss*4,sail*2' },
];

async function startDevServer() {
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  });
  await server.listen();
  return server;
}

function url(query) {
  return `${BASE}/?${query}&probe=1&notutorial=1`;
}

const MOBILE_CTX = {
  viewport: MOBILE,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

const DESKTOP_CTX = {
  viewport: DESKTOP,
  deviceScaleFactor: 1,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

/**
 * 컷마다 새 컨텍스트를 판다. 같은 컨텍스트를 재사용하면 localStorage 가 공유돼
 * `?parts=` 가 누적되고 스크린샷이 매번 달라진다.
 */
async function openScene(browser, ctxOptions, query) {
  const context = await browser.newContext(ctxOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 25_000 });
  // 파도·구름이 자리를 잡도록 몇 초 흘려보낸다
  await page.waitForTimeout(2500);
  return { page, errors, context };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await startDevServer();
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const report = [];
  let failed = false;

  const check = (name, label, probe, errors) => {
    const mean = probe?.mean ?? 0;
    const ok = mean >= MIN_MEAN_LUMINANCE && errors.length === 0;
    if (!ok) failed = true;
    report.push({ name, label, mean, p10: probe?.p10 ?? 0, errors, ok });
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(14)} ${label.padEnd(5)} ` +
        `평균휘도 ${mean.toFixed(3)} (하위10% ${(probe?.p10 ?? 0).toFixed(3)})` +
        (errors.length ? ` — 에러 ${errors.length}건: ${errors[0]}` : ''),
    );
  };

  try {
    // --- 모바일 4개 시간대 ---
    for (const shot of PHASE_SHOTS) {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url(`phase=${shot.phase}&res=${shot.res}&parts=${shot.parts}`),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
      check(shot.name, shot.label, probe, errors);
      await context.close();
    }

    // --- 수거 연출 + 시트 ---
    {
      const { page, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=day&res=full&parts=engine*2,window*2,moss*2'),
      );
      await page.evaluate(() => window.molehang?.collect());
      await page.waitForTimeout(260);
      await page.screenshot({ path: path.join(OUT, 'collect.png') });
      await page.waitForTimeout(500);
      await page.click('#open-sheet');
      await page.waitForTimeout(650);
      await page.screenshot({ path: path.join(OUT, 'sheet.png') });
      await context.close();
    }

    // --- 튜토리얼 (첫 방문 · 저장 없는 새 컨텍스트) ---
    {
      const context = await browser.newContext(MOBILE_CTX);
      const page = await context.newPage();
      await page.goto(`${BASE}/?phase=day&res=200`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 25_000 });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: path.join(OUT, 'tutorial-1.png') });
      await page.click('#tutorial-next');
      await page.waitForTimeout(500);
      await page.click('#tutorial-next');
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, 'tutorial-3.png') });
      await context.close();
    }

    // --- 괴상한 배 (바이럴용) ---
    {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=dusk&res=full&parts=engine*12,chimney*6,moss*8,cannon*4,lantern*4'),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, 'cursed-ship.png') });
      check('cursed-ship', '괴선', probe, errors);
      await context.close();
    }

    // --- PC ---
    for (const shot of [PHASE_SHOTS[0], PHASE_SHOTS[1]]) {
      const { page, errors, context } = await openScene(
        browser,
        DESKTOP_CTX,
        url(`phase=${shot.phase}&res=${shot.res}&parts=engine*3,window*5,sail*2,lantern*3,moss*3`),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, `desktop-${shot.name}.png`) });
      check(`desktop-${shot.name}`, shot.label, probe, errors);
      if (shot === PHASE_SHOTS[0]) {
        await page.click('#open-sheet');
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT, 'desktop-sheet.png') });
      }
      await context.close();
    }

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
