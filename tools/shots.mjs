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
  // 밤은 등불이 있는 배 — 등불 없는 배는 아래 night-dark 컷에서 따로 본다
  { name: 'night', phase: 'night', label: '밤', res: '150', parts: 'lantern*4,beacon' },
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
        url('phase=dusk&res=full&parts=engine*12,chimney*6,moss*8,cannon*4,lantern*4,barnacle*6,gullNest*3,ghost'),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, 'cursed-ship.png') });
      check('cursed-ship', '괴선', probe, errors);
      await context.close();
    }

    // --- 항해모드 (WASD 로 암초를 향해 몬다 — 첫 암초는 반드시 정면에 있다) ---
    {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=day&res=300&voyage=1&parts=engine*2,sail'),
      );
      await page.keyboard.down('w');
      await page.waitForTimeout(3000);
      await page.keyboard.up('w');
      await page.waitForTimeout(400);
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, 'voyage.png') });
      check('voyage', '항해', probe, errors);

      // 계속 몰면 정면의 암초에 부딪힌다 — 튕김 + 토스트 (+확률로 따개비)
      await page.keyboard.down('w');
      await page.waitForTimeout(4500);
      await page.keyboard.up('w');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, 'voyage-hit.png') });
      await context.close();
    }

    // --- 방치 컨텐츠 (80시간 비운 배 — 이끼·둥지·유령이 저절로 붙는다) ---
    {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=day&res=300&away=80&parts=engine*2,lantern'),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, 'idle-return.png') });
      check('idle-return', '방치', probe, errors);
      await context.close();
    }

    // --- 황금 오리 (저확률 밸런스 붕괴 부품) ---
    {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=dusk&res=full&parts=goldenDuck,kraken,duck*3,wheelhouse,paddle*2'),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, 'golden.png') });
      check('golden', '황금', probe, errors);
      await context.close();
    }

    // --- 밤: 등불 없는 배 (어둠에 잠긴다) + 뽑기 돌림판 ---
    {
      const { page, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=night&res=150&parts=engine*2,moss*3'),
      );
      await page.screenshot({ path: path.join(OUT, 'night-dark.png') });
      await context.close();
    }
    {
      const { page, context } = await openScene(browser, MOBILE_CTX, url('phase=day&scrap=9000'));
      await page.click('#draw-large');
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, 'gacha-spin.png') });
      await page.waitForTimeout(2200);
      await page.screenshot({ path: path.join(OUT, 'gacha-result.png') });
      await context.close();
    }
    {
      const { page, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=day&scrap=99999&parts=engine*4'),
      );
      await page.click('#draw-medium');
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(OUT, 'gacha-room.png') });
      await context.close();
    }

    // --- 테마 (같은 15색을 다르게 조합한 바다들) ---
    for (const theme of ['emerald', 'ember', 'steel', 'abyssal']) {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url(`phase=day&res=300&parts=sail,lantern*2&theme=${theme}`),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, `theme-${theme}.png`) });
      check(`theme-${theme}`, '테마', probe, errors);
      await context.close();
    }

    // --- 배치 모드 ---
    {
      const { page, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=day&parts=chimney*2,lantern*2,cannon,barrel'),
      );
      await page.click('#arrange-toggle');
      await page.waitForTimeout(500);
      // 부품 하나를 실제로 집어 옮기는 중간 장면
      const spots = await page.evaluate(() => window.molehang.partScreenPositions());
      if (spots.length > 0) {
        await page.mouse.move(spots[0].x, spots[0].y);
        await page.mouse.down();
        await page.mouse.move(spots[0].x - 26, spots[0].y - 34, { steps: 8 });
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: path.join(OUT, 'arrange.png') });
      await page.mouse.up();
      await context.close();
    }

    // --- 배치 모드 · 밤 (테두리는 조명을 안 받는다 — 어둠에 같이 잠기면 조작이 안 보인다) ---
    {
      const { page, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=night&parts=chimney*2,cannon,barrel'),
      );
      await page.click('#arrange-toggle');
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, 'arrange-night.png') });
      await context.close();
    }

    // --- 망원경 (배율 양 끝 + 확대한 채 끌기) ---
    for (const scope of [
      { name: 'scope-wide', zoom: '0.4', label: '망망' },
      { name: 'scope-close', zoom: '4', label: '망원' },
    ]) {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url(`phase=day&res=300&zoom=${scope.zoom}&parts=sail,lantern*2,barrel,cannon`),
      );
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await page.screenshot({ path: path.join(OUT, `${scope.name}.png`) });
      check(scope.name, scope.label, probe, errors);
      await context.close();
    }
    {
      // 확대한 상태에서 화면을 끌어 옮긴다 — 회전이 아니라 평행이동이어야 한다
      const { page, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=dusk&res=300&zoom=2.6&parts=chimney*2,lantern*2,sail'),
      );
      await page.mouse.move(MOBILE.width / 2, MOBILE.height / 2);
      await page.mouse.down();
      await page.mouse.move(MOBILE.width / 2 + 70, MOBILE.height / 2 + 90, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, 'scope-pan.png') });
      await context.close();
    }

/*
     * --- 배치 물리 ---
     * 부품을 허공으로 끌어올려도 닿는 자리에서 멈춘다.
     * 그림만으로는 "정말 닿았는지" 알 수 없으므로 좌표로도 확인한다.
     */
    {
      const { page, errors, context } = await openScene(
        browser,
        MOBILE_CTX,
        url('phase=day&zoom=1.5&parts=moss*2,barrel*2,lantern'),
      );
      await page.click('#arrange-toggle');
      await page.waitForTimeout(400);

      const spots = await page.evaluate(() => window.molehang.partScreenPositions());
      const moss = spots.find((s) => s.key === 'moss#0');
      if (moss !== undefined) {
        await page.mouse.move(moss.x, moss.y);
        await page.mouse.down();
        // 손가락은 하늘로 간다. 부품은 선체를 벗어나지 못해야 한다
        await page.mouse.move(moss.x, 110, { steps: 14 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, 'arrange-settle.png') });
        await page.mouse.up();
        await page.waitForTimeout(400);

        const seated = await page.evaluate(
          () => window.molehang.partPlacements().find((p) => p.key === 'moss#0')?.position ?? null,
        );
        // 갑판선(0.44~0.66)에서 한 뼘 안쪽이면 붙어 있는 것. 하늘로 갔으면 훨씬 크다
        if (seated === null || seated[1] > 1.2) {
          errors.push(`배치 물리: moss#0 이 허공에 남았다 (${JSON.stringify(seated)})`);
        } else {
          console.log(`     · 배치 물리 OK — moss#0 y=${seated[1].toFixed(2)} (선체에 붙음)`);
        }
      }
      const probe = await page.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      check('arrange-settle', '물리', probe, errors);
      await context.close();
    }

    // --- 계정 ---
    {
      const { page, context } = await openScene(browser, MOBILE_CTX, url('phase=dusk&res=200'));
      await page.click('#account-chip');
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, 'account.png') });
      await context.close();
    }

    // --- 선단 (같은 컨텍스트의 두 탭 = 두 선원) ---
    {
      const context = await browser.newContext(MOBILE_CTX);
      const a = await context.newPage();
      const b = await context.newPage();
      const q = 'phase=dusk&notutorial=1&probe=1&crew=CREWAA';
      await a.goto(`${BASE}/?${q}&seat=a&res=full&parts=engine*3,lantern*2`, { waitUntil: 'load' });
      await a.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 25_000 });
      await b.goto(`${BASE}/?${q}&seat=b&res=300&parts=moss*5,chimney*2`, { waitUntil: 'load' });
      await b.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 25_000 });
      await a.waitForTimeout(2200);

      // 동행선 — A 의 바다에 B 의 배가 같이 떠 있다 (솟아오르는 연출이 끝날 때까지 잠깐)
      await a.waitForTimeout(1800);
      const probeA = await a.evaluate(() => window.molehang?.sampleLuminance() ?? null);
      await a.screenshot({ path: path.join(OUT, 'crew-sails.png') });
      check('crew-sails', '동행', probeA, []);

      // A 가 수거하면 B 에게 배당 토스트가 뜬다
      await a.evaluate(() => window.molehang?.collect());
      await b.waitForTimeout(700);
      await b.screenshot({ path: path.join(OUT, 'crew-gift.png') });

      // B 도 60초 안에 수거 → 만선 콤보 (+30%) 토스트
      await b.evaluate(() => window.molehang?.collect());
      await b.waitForTimeout(700);
      await b.screenshot({ path: path.join(OUT, 'crew-combo.png') });

      await b.click('#open-sheet');
      await b.waitForTimeout(700);
      // 선단 섹션(효과 목록 포함)이 보이게 스크롤해서 찍는다
      await b.evaluate(() => document.getElementById('sec-crew')?.scrollIntoView({ block: 'start' }));
      await b.waitForTimeout(400);
      await b.screenshot({ path: path.join(OUT, 'crew-sheet.png') });
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
