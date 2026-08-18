import './style/style.css';

import { SystemClock, type Clock } from './core/clock.ts';
import {
  FixedTimeOfDay,
  LocalTimeOfDay,
  PHASE_ANCHOR_HOUR,
  type TimeOfDaySource,
} from './core/time-of-day.ts';
import { GAME_CONFIG, STORAGE_KEY } from './game/config.ts';
import { CrewSession } from './game/crew-session.ts';
import { Game } from './game/game.ts';
import { LocalGateway } from './game/local-gateway.ts';
import { PART_KINDS, type PartKind } from './game/parts.ts';
import { createCrewChannel } from './net/crew-channel.ts';
import { World } from './scene/world.ts';
import { PHASES, applyThemeVars, type Phase } from './style/palette.ts';
import { Hud } from './ui/hud.ts';
import { LogSheet } from './ui/sheet.ts';
import { Toasts } from './ui/toast.ts';
import { Tutorial } from './ui/tutorial.ts';

declare global {
  interface Window {
    molehang?: {
      setHour(hour: number): void;
      setPhase(phase: Phase): void;
      setStored(amount: number): Promise<void>;
      addParts(kinds: PartKind[]): Promise<void>;
      collect(): Promise<void>;
      crewMultiplier(): number;
      reset(): Promise<void>;
      tutorial(): void;
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

  // `?seat=` 은 저장소를 분리한다 — 같은 기기에서 친구 역할을 하나 더 띄워 보기 위한 것.
  // 없으면 평소대로 하나의 세이브를 쓴다.
  const seat = params.get('seat');
  const storageKey = seat === null ? STORAGE_KEY : `${STORAGE_KEY}.${seat}`;

  const channel = createCrewChannel();
  const gateway = new LocalGateway(GAME_CONFIG, undefined, undefined, storageKey);
  const game = new Game(gateway, clock, GAME_CONFIG, channel);

  const crew = new CrewSession(channel, seat);

  // 연출 시각: 기본은 **접속한 기기의 로컬 시각**, 디버그로만 고정 가능
  const timeSource: TimeOfDaySource = resolveTimeSource(params, clock);
  const world = new World(canvas, timeSource, {
    probe: params.has('probe') || params.has('hour') || params.has('phase'),
  });

  const toasts = new Toasts();
  const tutorial = new Tutorial();
  const sheet = new LogSheet(
    clock,
    () => game.log(),
    () => game.snapshot(),
    () => tutorial.start(),
    {
      code: () => crew.currentCode,
      inviteLink: () => crew.inviteLink(),
      join: (code) => {
        const snap = game.snapshot();
        if (crew.join(code, profileFrom(snap))) {
          void sheet.refresh();
        } else {
          globalThis.alert('코드가 올바르지 않아요. 6자리를 다시 확인해 주세요.');
        }
      },
    },
  );

  const profileFrom = (snap: ReturnType<typeof game.snapshot>) => ({
    name: crew.displayName,
    title: snap.title.name,
    partCount: snap.partCount,
  });
  const hud = new Hud({
    onCollect: () => void onCollect(),
    onOpenLog: () => void sheet.show(),
  });

  async function onCollect(): Promise<void> {
    const event = await game.collect();
    if (event === null) return;

    world.playCollect();
    // 얻은 파츠는 전부 그 자리에서 배에 붙는다
    world.setParts(event.snapshot.parts, true);
    hud.pulse();
    hud.render(event.snapshot);
    world.setFill(event.snapshot.fill);

    toasts.parts(event.gainedParts);
    if (event.newTitle !== null) {
      globalThis.setTimeout(() => toasts.title(event.newTitle!), 420);
    }
  }

  function paint(snap: ReturnType<typeof game.snapshot>): void {
    hud.render(snap);
    world.setFill(snap.fill);
    world.setParts(snap.parts);
    crew.update(profileFrom(snap));
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

    // 디버그: 파츠 강제 (`?parts=engine*12,moss*4`)
    const parts = params.get('parts');
    if (parts !== null) {
      await game.debugAddParts(parseParts(parts));
      snap = game.snapshot();
    }

    paint(snap);
    world.start();
    crew.start(params, profileFrom(snap));

    // HUD 는 초당 4회만 갱신해도 충분하다 (렌더 루프와 분리)
    globalThis.setInterval(() => paint(game.snapshot()), 250);

    game.onCollect(() => void sheet.refresh());

    // 친구가 수거하면 나에게도 자원과 부품이 떨어진다
    game.onGift((gift) => {
      const s = game.snapshot();
      paint(s);
      if (gift.part !== null) world.setParts(s.parts, true);
      world.playCollect();
      toasts.gift(gift);
      void sheet.refresh();
    });

    if (!params.has('notutorial')) tutorial.autoStart();

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
      paint(game.snapshot());
    },
    async addParts(kinds: PartKind[]) {
      await game.debugAddParts(kinds);
      paint(game.snapshot());
    },
    collect: onCollect,
    crewMultiplier: () => game.snapshot().crewMultiplier,
    async reset() {
      paint(await game.reset());
      await sheet.refresh();
    },
    tutorial: () => tutorial.start(),
    sampleLuminance: () => world.sampleLuminance(),
  };
}

/** `engine*12,moss*4,cannon` 형식 */
function parseParts(spec: string): PartKind[] {
  const out: PartKind[] = [];
  for (const chunk of spec.split(',')) {
    const [name, times] = chunk.split('*');
    const kind = (name ?? '').trim() as PartKind;
    if (!(PART_KINDS as readonly string[]).includes(kind)) continue;
    const n = Math.min(60, Math.max(1, Number.parseInt(times ?? '1', 10) || 1));
    for (let i = 0; i < n; i++) out.push(kind);
  }
  return out;
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

  // 기본값: 접속한 기기의 로컬 시각을 그대로 따라간다
  return new LocalTimeOfDay(clock);
}

boot();
