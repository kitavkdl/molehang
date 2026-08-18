/**
 * 돌림판 UX 진단 스크립트 (일회용 아님 — 문제 재현/수정 검증용).
 *   node tools/wheel-probe.mjs
 * docs/shots/probe-*.png 로 저장하고, 상태를 콘솔에 찍는다.
 */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'shots');
const PORT = 5177;
const BASE = `http://127.0.0.1:${PORT}`;

const MOBILE_CTX = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
};

async function open(browser, query) {
  const context = await browser.newContext(MOBILE_CTX);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${BASE}/?${query}&notutorial=1&guest=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 25_000 });
  await page.waitForTimeout(800);
  return { page, context, errors };
}

async function scrapOf(page) {
  return page.evaluate(() => document.getElementById('wallet-amount').textContent);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
  });
  await server.listen();
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  try {
    // 1) 작은 부품 — 10조각 돌림판 라벨 겹침 확인
    {
      const { page, context } = await open(browser, 'phase=day&scrap=99999');
      await page.click('#draw-small');
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, 'probe-small-spin.png') });
      await page.waitForTimeout(2600);
      await page.screenshot({ path: path.join(OUT, 'probe-small-result.png') });
      await context.close();
    }

    // 2) 중간 부품 — 9조각
    {
      const { page, context } = await open(browser, 'phase=day&scrap=99999');
      await page.click('#draw-medium');
      await page.waitForTimeout(3300);
      await page.screenshot({ path: path.join(OUT, 'probe-medium-result.png') });
      await context.close();
    }

    // 3) 더블탭 — 두 번 결제되는지 (핵심 의심 버그)
    {
      const { page, context, errors } = await open(browser, 'phase=day&scrap=99999');
      const before = await scrapOf(page);
      await page.click('#draw-small');
      await page.click('#draw-small', { force: true }).catch(() => {});
      await page.waitForTimeout(400);
      const mid = await scrapOf(page);
      await page.waitForTimeout(3200);
      const after = await scrapOf(page);
      await page.screenshot({ path: path.join(OUT, 'probe-doubletap.png') });
      console.log(`더블탭: 시작 ${before} → 직후 ${mid} → 결과 ${after} (60만 빠져야 정상)`);
      if (errors.length) console.log('  콘솔 에러:', errors[0]);
      await context.close();
    }

    // 4) 스핀 중 화면 상태 — 결과 전에 '장착하기'가 미리 보이는지 / 닫기 잠금
    {
      const { page, context } = await open(browser, 'phase=day&scrap=99999');
      await page.click('#draw-large');
      await page.waitForTimeout(1200);
      const state = await page.evaluate(() => ({
        confirmHidden: document.getElementById('gacha-confirm').hidden,
        closeDisabled: document.getElementById('gacha-close').disabled,
        resultHidden: document.getElementById('gacha-result').hidden,
      }));
      console.log('스핀 중 상태:', JSON.stringify(state));
      await page.waitForTimeout(2400);
      const state2 = await page.evaluate(() => ({
        confirmHidden: document.getElementById('gacha-confirm').hidden,
        closeDisabled: document.getElementById('gacha-close').disabled,
        resultHidden: document.getElementById('gacha-result').hidden,
      }));
      console.log('결과 상태:', JSON.stringify(state2));
      await context.close();
    }

    // 5) 자리 부족 흐름 — 교체 선택 목록 + 스크롤
    {
      const { page, context } = await open(browser, 'phase=day&scrap=99999&parts=engine*4');
      await page.click('#draw-medium');
      await page.waitForTimeout(3400);
      await page.screenshot({ path: path.join(OUT, 'probe-room.png') });
      // 패널이 화면을 넘는지
      const overflow = await page.evaluate(() => {
        const g = document.getElementById('gacha');
        const r = g.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, vh: innerHeight };
      });
      console.log('자리부족 패널:', JSON.stringify(overflow));
      await context.close();
    }

    // 6) 테마 돌림판
    {
      const { page, context } = await open(browser, 'phase=day&scrap=99999');
      await page.evaluate(() => window.molehang.drawTheme());
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(OUT, 'probe-theme-spin.png') });
      await page.waitForTimeout(2600);
      await page.screenshot({ path: path.join(OUT, 'probe-theme-result.png') });
      await context.close();
    }

    // 7) 고철 없이 뽑기 (버튼은 disabled 지만 API 로) — 취소 경로
    {
      const { page, context } = await open(browser, 'phase=day&scrap=10');
      await page.evaluate(() => window.molehang.draw('small'));
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(OUT, 'probe-poor.png') });
      const visible = await page.evaluate(() => !document.getElementById('gacha').hidden);
      console.log('고철 부족 시 패널 열림 여부(닫혀야 정상):', visible);
      await context.close();
    }

    // 8) 아바타 — 시트의 커스터마이즈 + 갑판 위 내 아바타
    {
      const { page, context } = await open(browser, 'phase=day&res=300&parts=lantern*2,sail');
      await page.screenshot({ path: path.join(OUT, 'probe-avatar-deck.png') });
      await page.click('#open-sheet');
      await page.waitForTimeout(700);
      await page.evaluate(() => document.getElementById('sec-avatar').scrollIntoView());
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, 'probe-avatar-sheet.png') });
      // 모자·옷을 바꿔 본다
      await page.evaluate(() => {
        const hats = document.querySelectorAll('#avatar-hats .theme-chip');
        hats[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const dots = document.querySelectorAll('#avatar-outfits .avatar-dot');
        dots[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForTimeout(300);
      await page.click('#close-sheet');
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, 'probe-avatar-changed.png') });
      await context.close();
    }

    // 10) 닫기 직후 재열기 — hide() 의 지연 숨김 타이머가 새 판을 죽이면 안 된다
    {
      const { page, context } = await open(browser, 'phase=day&scrap=99999');
      await page.click('#draw-small');
      await page.waitForTimeout(3600); // 스핀 종료 + 결과
      await page.click('#gacha-confirm'); // 장착 → hide 타이머 시작
      await page.waitForTimeout(60);
      await page.click('#draw-small'); // 240ms 안에 재열기
      await page.waitForTimeout(500); // 옛 타이머(240ms)가 지나간 뒤
      const alive = await page.evaluate(() => !document.getElementById('gacha').hidden);
      await page.waitForTimeout(3200);
      const result = await page.evaluate(
        () => !document.getElementById('gacha-result').hidden,
      );
      console.log(`재열기 레이스: 판 생존=${alive} (true 여야 정상), 결과 표시=${result}`);
      await context.close();
    }

    // 11) 수거 연타 — 한 번만 정산돼야 한다
    // (수거 버튼은 가득 차면 상시 애니메이션이라 Playwright 클릭 대신 직접 dispatch)
    {
      const { page, context } = await open(browser, 'phase=day&res=full');
      const cap = await page.evaluate(() => document.getElementById('stock-cap').textContent);
      await page.evaluate(() => {
        document.getElementById('collect').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.getElementById('collect').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        void window.molehang.collect(); // 세 번째 시도 (API 직통)
      });
      await page.waitForTimeout(900);
      const wallet = await scrapOf(page);
      console.log(`수거 연타: 상한 ${cap?.trim()} → 지갑 ${wallet} (상한 수치 1회분이어야 정상)`);
      await context.close();
    }

    // 12) 시트·계정 닫고 바로 재열기 — 지연 숨김 타이머 생존 확인
    {
      const { page, context } = await open(browser, 'phase=day&res=200');
      await page.click('#open-sheet');
      await page.waitForTimeout(400);
      await page.click('#close-sheet');
      await page.waitForTimeout(60);
      await page.click('#open-sheet');
      await page.waitForTimeout(500);
      const sheetAlive = await page.evaluate(() => !document.getElementById('sheet').hidden);
      await page.click('#close-sheet');
      await page.waitForTimeout(400);

      await page.click('#account-chip');
      await page.waitForTimeout(400);
      await page.click('#account-close');
      await page.waitForTimeout(60);
      await page.click('#account-chip');
      await page.waitForTimeout(500);
      const accountAlive = await page.evaluate(() => !document.getElementById('account').hidden);
      console.log(`재열기: 시트 생존=${sheetAlive}, 계정 생존=${accountAlive} (둘 다 true 여야 정상)`);
      await context.close();
    }

    // 9) 선단 아바타 — 두 탭이 같은 선단이면 갑판에 두 명이 선다
    {
      const context = await browser.newContext(MOBILE_CTX);
      const a = await context.newPage();
      const b = await context.newPage();
      const q = 'phase=day&notutorial=1&guest=1&crew=CREWAA';
      await a.goto(`${BASE}/?${q}&seat=a&res=300&parts=sail,lantern`, { waitUntil: 'load' });
      await a.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 25_000 });
      await b.goto(`${BASE}/?${q}&seat=b&res=300&parts=chimney*2`, { waitUntil: 'load' });
      await b.waitForFunction(() => window.__MOLEHANG_READY__ === true, null, { timeout: 25_000 });
      await b.waitForTimeout(2500);
      await b.screenshot({ path: path.join(OUT, 'probe-avatar-crew.png') });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
