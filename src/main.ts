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
import { Game, type GameSnapshot } from './game/game.ts';
import { LocalGateway } from './game/local-gateway.ts';
import type { MolehangGateway } from './game/gateway.ts';
import { PART_KINDS, type PartKind, type PartTier } from './game/parts.ts';
import { applyStatic, locale, setLocale, t } from './i18n/index.ts';
import { Auth } from './net/auth.ts';
import { createCrewChannel } from './net/crew-channel.ts';
import { SupabaseGateway, listShips } from './net/supabase-gateway.ts';
import { AccountPanel, selectShip, selectedShipId } from './ui/account.ts';
import { World } from './scene/world.ts';
import { PHASES, applyThemeVars, type Phase } from './style/palette.ts';
import { GachaPanel } from './ui/gacha.ts';
import { Hud } from './ui/hud.ts';
import { LogSheet } from './ui/sheet.ts';
import { Toasts } from './ui/toast.ts';
import { Tutorial } from './ui/tutorial.ts';

declare global {
  interface Window {
    molehang?: {
      setHour(hour: number): void;
      setPhase(phase: Phase): void;
      setScrap(amount: number): Promise<void>;
      setPending(amount: number): Promise<void>;
      addParts(kinds: PartKind[]): Promise<void>;
      collect(): Promise<void>;
      draw(tier: PartTier): Promise<void>;
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
  document.documentElement.lang = locale();

  const params = new URLSearchParams(globalThis.location.search);
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('[molehang] #stage 캔버스를 찾을 수 없습니다');

  const clock: Clock = new SystemClock();

  // `?seat=` 은 저장소를 분리한다 — 같은 기기에서 친구 역할을 하나 더 띄우기 위한 것
  const seat = params.get('seat');
  const storageKey = seat === null ? STORAGE_KEY : `${STORAGE_KEY}.${seat}`;

  const channel = createCrewChannel();
  const local = new LocalGateway(GAME_CONFIG, undefined, undefined, storageKey);
  const crew = new CrewSession(channel, seat);

  // 로그인 상태는 부팅 중에 정해진다. 그 전까지는 게스트(로컬)로 시작해
  // **네트워크가 죽어도 게임이 뜨게** 한다.
  const auth = new Auth();
  let gateway: MolehangGateway = local;
  const game = new Game(gateway, clock, GAME_CONFIG, channel);

  const toasts = new Toasts();
  const tutorial = new Tutorial();

  const profileFrom = (snap: GameSnapshot) => ({
    name: crew.displayName,
    title: snap.title.name[locale()],
    partCount: snap.partCount,
  });

  const sheet = new LogSheet(
    clock,
    () => game.log(),
    () => game.snapshot(),
    () => tutorial.start(),
    {
      code: () => crew.currentCode,
      inviteLink: () => crew.inviteLink(),
      join: (code) => {
        if (crew.join(code, profileFrom(game.snapshot()))) void sheet.refresh();
        else toasts.warn(t('crew.badCode'));
      },
    },
  );

  const gacha = new GachaPanel({
    draw: async (tier) => {
      const event = await game.draw(tier);
      if (event === null) return null;
      return { drawn: event.drawn, needsRoom: event.needsRoom, removable: event.removable };
    },
    install: async (kind, remove) => {
      const outcome = await game.install(kind, remove);
      if (outcome === null) return;
      const snap = game.snapshot();
      paint(snap);
      // 새로 붙은 부품만 팝으로 등장
      world.setParts(snap.parts, true);
      world.playCollect();
      toasts.installed(outcome.installed, outcome.removed);
      const unlocked = game.titleById(outcome.newTitleId);
      if (unlocked !== null) globalThis.setTimeout(() => toasts.title(unlocked), 420);
      void sheet.refresh();
    },
    onCantAfford: () => toasts.warn(t('gacha.cantAfford')),
  });

  const hud = new Hud({
    onCollect: () => void onCollect(),
    onOpenLog: () => void sheet.show(),
    onDraw: (tier) => void gacha.open(tier, game.snapshot()),
    onToggleLang: () => {
      setLocale(locale() === 'ko' ? 'en' : 'ko');
      hud.invalidate();
      paint(game.snapshot());
      void sheet.refresh();
    },
  });

  const timeSource: TimeOfDaySource = resolveTimeSource(params, clock);
  const world = new World(canvas, timeSource, {
    probe: params.has('probe') || params.has('hour') || params.has('phase'),
  });

  function paint(snap: GameSnapshot): void {
    hud.render(snap);
    world.setFill(snap.fill);
    world.setParts(snap.parts);
    world.setLight(snap.light);
    crew.update(profileFrom(snap));
  }

  async function onCollect(): Promise<void> {
    const event = await game.collect();
    if (event === null) return;
    world.playCollect();
    hud.pulse();
    paint(event.snapshot);
  }

  const account = new AccountPanel(
    auth,
    () => local.snapshotForImport(),
    // 로그인·배 전환은 게이트웨이 자체가 바뀌는 일이라, 상태를 이어 붙이는 대신
    // 새로 부팅한다. 훨씬 단순하고 어긋날 여지가 없다.
    () => globalThis.location.reload(),
  );

  void (async () => {
    // 로그인돼 있으면 클라우드 세이브로 갈아탄다. 실패하면 게스트로 계속 논다.
    if (!params.has('guest')) {
      try {
        const state = await auth.restore();
        if (state.kind === 'signed-in') {
          const shipId = await resolveShipId();
          if (shipId !== null) {
            gateway = new SupabaseGateway(shipId, GAME_CONFIG);
            game.useGateway(gateway);
          }
        }
      } catch (err) {
        console.warn('[molehang] 클라우드 세이브를 쓰지 못해 게스트로 시작합니다', err);
      }
    }
    account.renderChip();

    let snap = await game.start();

    const scrap = params.get('scrap');
    if (scrap !== null) {
      const value = Number.parseFloat(scrap);
      if (Number.isFinite(value)) {
        await game.debugSetScrap(value);
        snap = game.snapshot();
      }
    }

    const res = params.get('res');
    if (res !== null) {
      const value = res === 'full' ? snap.capacity : Number.parseFloat(res);
      if (Number.isFinite(value)) {
        await game.debugSetPending(value);
        snap = game.snapshot();
      }
    }

    const parts = params.get('parts');
    if (parts !== null) {
      await game.debugAddParts(parseParts(parts));
      snap = game.snapshot();
    }

    applyStatic();
    paint(snap);
    world.start();
    crew.start(params, profileFrom(snap));

    globalThis.setInterval(() => paint(game.snapshot()), 250);

    game.onCollect(() => void sheet.refresh());
    game.onGift((gift) => {
      paint(game.snapshot());
      toasts.gift(gift);
      void sheet.refresh();
    });

    if (!params.has('notutorial')) tutorial.autoStart();

    window.__MOLEHANG_READY__ = true;
  })();

  window.molehang = {
    setHour: (hour) => world.setTimeSource(new FixedTimeOfDay(hour)),
    setPhase: (phase) => world.setTimeSource(new FixedTimeOfDay(PHASE_ANCHOR_HOUR[phase])),
    async setScrap(value) {
      await game.debugSetScrap(value);
      paint(game.snapshot());
    },
    async setPending(value) {
      await game.debugSetPending(value);
      paint(game.snapshot());
    },
    async addParts(kinds) {
      await game.debugAddParts(kinds);
      paint(game.snapshot());
    },
    collect: onCollect,
    async draw(tier) {
      await gacha.open(tier, game.snapshot());
    },
    crewMultiplier: () => game.snapshot().crewMultiplier,
    async reset() {
      paint(await game.reset());
      await sheet.refresh();
    },
    tutorial: () => tutorial.start(),
    sampleLuminance: () => world.sampleLuminance(),
  };
}

/** 고른 배가 없거나 사라졌으면 첫 배로 돌아간다 */
async function resolveShipId(): Promise<string | null> {
  const ships = await listShips();
  if (ships.length === 0) return null;

  const saved = selectedShipId();
  const found = ships.find((s) => s.id === saved);
  const chosen = found ?? ships[0]!;
  selectShip(chosen.id);
  return chosen.id;
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
