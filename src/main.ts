import './style/style.css';

import { SystemClock, type Clock } from './core/clock.ts';
import {
  FixedTimeOfDay,
  LocalTimeOfDay,
  PHASE_ANCHOR_HOUR,
  type TimeOfDaySource,
} from './core/time-of-day.ts';
import { GAME_CONFIG } from './game/config.ts';
import { Game } from './game/game.ts';
import { LocalGateway } from './game/local-gateway.ts';
import { applyThemeVars } from './style/palette.ts';
import { World } from './scene/world.ts';
import { Hud } from './ui/hud.ts';
import { LogSheet } from './ui/sheet.ts';
import { PHASES, type Phase } from './style/palette.ts';

declare global {
  interface Window {
    molehang?: {
      setHour(hour: number): void;
      setPhase(phase: Phase): void;
      setStored(amount: number): Promise<void>;
      collect(): Promise<void>;
      reset(): Promise<void>;
      sampleLuminance(): { mean: number; p10: number } | null;
    };
    __MOLEHANG_READY__?: boolean;
  }
}

function boot(): void {
  // CSS 변수 주입이 첫 페인트보다 먼저 와야 한다
  applyThemeVars();

  const params = new URLSearchParams(globalThis.location.search);
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('[molehang] #stage 캔버스를 찾을 수 없습니다');

  const clock: Clock = new SystemClock();
  const gateway = new LocalGateway(GAME_CONFIG);
  const game = new Game(gateway, clock, GAME_CONFIG);

  // 연출 시각: 기본은 유저 로컬 시각, 디버그로 고정 가능
  const timeSource: TimeOfDaySource = resolveTimeSource(params, clock);
  const world = new World(canvas, timeSource, { probe: params.has('probe') || params.has('hour') || params.has('phase') });

  const sheet = new LogSheet(clock, () => game.log());
  const hud = new Hud({
    onCollect: () => void onCollect(),
    onOpenLog: () => void sheet.show(),
  });

  async function onCollect(): Promise<void> {
    const event = await game.collect();
    if (event === null) return;
    world.playCollect();
    hud.pulse();
    hud.render(event.snapshot);
    world.setFill(event.snapshot.fill);
  }

  void (async () => {
    let snap = await game.start();

    // 디버그: 보유량 강제 (`?res=full` / `?res=250`)
    const res = params.get('res');
    if (res !== null) {
      const value = res === 'full' ? GAME_CONFIG.capacity : Number.parseFloat(res);
      if (Number.isFinite(value)) {
        await game.debugSetStored(value);
        snap = game.snapshot();
      }
    }

    hud.render(snap);
    world.setFill(snap.fill);
    world.start();

    // HUD 는 초당 4회만 갱신해도 충분하다 (렌더 루프와 분리)
    globalThis.setInterval(() => {
      const s = game.snapshot();
      hud.render(s);
      world.setFill(s.fill);
    }, 250);

    game.onCollect(() => void sheet.refresh());

    window.__MOLEHANG_READY__ = true;
  })();

  // 디버그 훅 — Playwright 스크린샷/밝기 검증이 사용한다
  window.molehang = {
    setHour(hour: number) {
      world.setTimeSource(new FixedTimeOfDay(hour));
    },
    setPhase(phase: Phase) {
      world.setTimeSource(new FixedTimeOfDay(PHASE_ANCHOR_HOUR[phase]));
    },
    async setStored(value: number) {
      await game.debugSetStored(value);
      const s = game.snapshot();
      hud.render(s);
      world.setFill(s.fill);
    },
    collect: onCollect,
    async reset() {
      const s = await game.reset();
      hud.render(s);
      world.setFill(s.fill);
      await sheet.refresh();
    },
    sampleLuminance: () => world.sampleLuminance(),
  };
}

function resolveTimeSource(params: URLSearchParams, clock: Clock): TimeOfDaySource {
  const hour = params.get('hour');
  if (hour !== null) {
    const value = Number.parseFloat(hour);
    if (Number.isFinite(value)) return new FixedTimeOfDay(value);
  }

  const phase = params.get('phase');
  if (phase !== null && (PHASES as readonly string[]).includes(phase)) {
    return new FixedTimeOfDay(PHASE_ANCHOR_HOUR[phase as Phase]);
  }

  return new LocalTimeOfDay(clock);
}

boot();
