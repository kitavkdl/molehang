import './style/style.css';

import { SystemClock, type Clock } from './core/clock.ts';
import {
  FixedTimeOfDay,
  LocalTimeOfDay,
  PHASE_ANCHOR_HOUR,
  type TimeOfDaySource,
} from './core/time-of-day.ts';
import { AvatarStore } from './game/avatar.ts';
import { GAME_CONFIG, STORAGE_KEY } from './game/config.ts';
import { CrewSession } from './game/crew-session.ts';
import { Game, type GameSnapshot } from './game/game.ts';
import { LocalGateway } from './game/local-gateway.ts';
import type { MolehangGateway } from './game/gateway.ts';
import {
  PART_INFO,
  PART_KINDS,
  removableKinds,
  type PartKind,
  type PartTier,
} from './game/parts.ts';
import { applyStatic, locale, setLocale, t } from './i18n/index.ts';
import { Auth } from './net/auth.ts';
import { createCrewChannel } from './net/crew-channel.ts';
import { SupabaseGateway, listShips } from './net/supabase-gateway.ts';
import { AccountPanel, selectShip, selectedShipId } from './ui/account.ts';
import { ArrangeUi } from './ui/arrange-ui.ts';
import { TelescopeUi } from './ui/telescope-ui.ts';
import { VoyageUi } from './ui/voyage-ui.ts';
import { World } from './scene/world.ts';
import { PHASES, applyThemeVars, type Phase } from './style/palette.ts';
import { THEMES, THEME_IDS, isThemeId, themeName } from './style/themes.ts';
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
      setZoom(zoom: number): void;
      setScrap(amount: number): Promise<void>;
      setPending(amount: number): Promise<void>;
      addParts(kinds: PartKind[]): Promise<void>;
      setPlacement(key: string, position: [number, number, number]): Promise<void>;
      partScreenPositions(): Array<{ key: string; x: number; y: number }>;
      partPlacements(): Array<{ key: string; position: [number, number, number] }>;
      drawTheme(): Promise<void>;
      collect(): Promise<void>;
      draw(tier: PartTier): Promise<void>;
      crewMultiplier(): number;
      voyage(active: boolean): void;
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
  // 아바타는 사람의 것 — 선단 이름과 같은 자리에 산다 (배 저장과 무관)
  const avatarStore = new AvatarStore(seat);

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
    avatar: avatarStore.current,
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
    {
      draw: () => void drawTheme(),
      select: (id) => {
        void (async () => {
          await game.setTheme(id);
          world.setTheme(id);
          paint(game.snapshot());
          await sheet.refresh();
        })();
      },
    },
    {
      current: () => avatarStore.current,
      setHat: (hat) => {
        avatarStore.set({ hat });
        paint(game.snapshot());
      },
      setOutfit: (outfit) => {
        avatarStore.set({ outfit });
        paint(game.snapshot());
      },
    },
  );

  /** 테마 뽑기 — 돌림판을 부품 뽑기와 공유한다 */
  async function drawTheme(): Promise<void> {
    const snap = game.snapshot();
    if (snap.themesLeft === 0) {
      toasts.warn(t('theme.soldOut'));
      return;
    }
    if (snap.scrap < snap.themeCost) {
      toasts.warn(t('gacha.cantAfford'));
      return;
    }

    // 아직 없는 테마만 돌림판에 올린다
    const pool = THEME_IDS.filter((id) => THEMES[id].weight > 0 && !snap.themes.includes(id));
    sheet.hide();

    await gacha.openTheme(
      pool.map((id) => themeName(id, locale())),
      async () => {
        const result = await game.drawTheme();
        if (result.drawn === null) return null;
        world.setTheme(result.drawn);
        paint(game.snapshot());
        return {
          label: themeName(result.drawn, locale()),
          index: Math.max(0, pool.indexOf(result.drawn)),
        };
      },
    );
    // 테마를 고르던 자리로 돌려보낸다 — 뽑고 나면 대개 바꿔 껴 보고 싶어진다
    await sheet.show();
  }

  /**
   * 뽑기는 "고철 차감 → 돌림판 → 장착 확정"이 여러 단계라, 중간에 새로고침하면
   * 고철만 쓰고 부품을 잃는다. 뽑힌 부품을 저장해 뒀다가 다음 부팅 때 장착을 마저 받는다.
   * 저장 범위는 배 단위 — 게스트 좌석·계정 배가 서로 섞이면 안 된다.
   */
  let pendingDrawKey = `molehang.pendingDraw.${seat === null ? 'local' : `local.${seat}`}`;
  // 게스트 세이브는 sessionStorage 에 산다 — 복구 기록도 같은 수명을 가져야
  // 세이브가 사라진 뒤 유령 뽑기가 되살아나 공짜 부품이 생기지 않는다.
  let pendingDrawStore: () => Storage | undefined = () => globalThis.sessionStorage;
  const savePendingDraw = (kind: PartKind): void => {
    try {
      pendingDrawStore()?.setItem(pendingDrawKey, kind);
    } catch {
      // 저장 못 하면 복구도 없다 — 게임은 계속 굴러간다
    }
  };
  const takePendingDraw = (): PartKind | null => {
    try {
      const raw = pendingDrawStore()?.getItem(pendingDrawKey);
      return raw !== null && raw !== undefined && (PART_KINDS as readonly string[]).includes(raw)
        ? (raw as PartKind)
        : null;
    } catch {
      return null;
    }
  };
  const clearPendingDraw = (): void => {
    try {
      pendingDrawStore()?.removeItem(pendingDrawKey);
    } catch {
      // 무시
    }
  };

  const gacha = new GachaPanel({
    draw: async (tier) => {
      const event = await game.draw(tier);
      if (event === null) return null;
      savePendingDraw(event.drawn);
      return { drawn: event.drawn, needsRoom: event.needsRoom, removable: event.removable };
    },
    install: async (kind, remove) => {
      const outcome = await game.install(kind, remove);
      clearPendingDraw();
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
      arrangeUi.refreshLabels();
      voyageUi.refreshLabels();
      telescopeUi.render(world.zoom);
      account.renderChip();
      paint(game.snapshot());
      void sheet.refresh();
    },
  });

  const timeSource: TimeOfDaySource = resolveTimeSource(params, clock);
  const world = new World(canvas, timeSource, {
    probe: params.has('probe') || params.has('hour') || params.has('phase'),
  });

  const arrangeUi = new ArrangeUi({
    onChange: (active) => world.setArrangeMode(active),
    onReset: () => void game.resetPlacements(),
  });
  world.onArrangePick((key) => arrangeUi.showPicked(key));
  world.onArrangeSettle((settling) => arrangeUi.showSettling(settling));
  world.onArrangeDrop((key, position) => void game.savePlacement(key, position));

  // 항해와 배치는 겹치지 않는다 — 평소엔 버튼이 서로 가려 못 겹치지만,
  // 디버그 API(molehang.voyage)로 들어와도 상태가 꼬이지 않게 서로 접는다
  const voyageUi = new VoyageUi(
    (active) => {
      if (active) arrangeUi.close();
      world.setVoyageMode(active);
    },
    () => world.voyageSpeed,
  );

  // 암초 충돌 — 벌점은 없다. 대신 따개비가 붙는다(반드시 장착, 뽑기와 같은 유머)
  const BARNACLE_CHANCE = 0.45;
  const BARNACLE_MAX = 24;
  let barnaclePending = false;
  world.onReefHit(() => {
    toasts.warn(t('voyage.hit'));
    if (barnaclePending) return;
    if (Math.random() >= BARNACLE_CHANCE) return;
    if (game.snapshot().parts.barnacle >= BARNACLE_MAX) return;
    barnaclePending = true;
    void (async () => {
      try {
        const outcome = await game.install('barnacle', null);
        if (outcome === null) return;
        const snap = game.snapshot();
        paint(snap);
        world.setParts(snap.parts, true);
        toasts.installed('barnacle', null);
        const unlocked = game.titleById(outcome.newTitleId);
        if (unlocked !== null) globalThis.setTimeout(() => toasts.title(unlocked), 420);
        void sheet.refresh();
      } finally {
        barnaclePending = false;
      }
    })();
  });

  const telescopeUi = new TelescopeUi({
    onZoom: (zoom) => world.setZoom(zoom),
    onReset: () => world.resetView(),
  });
  // 휠·핀치로 바뀐 배율도 슬라이더에 되비친다
  world.onZoomChange((zoom) => telescopeUi.render(zoom));
  telescopeUi.render(world.zoom);

  function paint(snap: GameSnapshot): void {
    world.setTheme(snap.theme);
    hud.render(snap);
    world.setFill(snap.fill);
    world.setParts(snap.parts, false, snap.placements);
    world.setLight(snap.light);
    world.setVoyageSpeed(snap.voyageSpeed);
    // 갑판 위 선장들 — 첫 번째가 나, 뒤는 같이 접속해 있는 선원들
    world.setAvatars([avatarStore.current, ...snap.crew.map((m) => m.avatar)]);
    crew.update(profileFrom(snap));
  }

  async function onCollect(): Promise<void> {
    hud.setCollecting(true);
    try {
      const event = await game.collect();
      if (event === null) return;
      world.playCollect();
      hud.pulse();
      paint(event.snapshot);
    } finally {
      hud.setCollecting(false);
    }
  }

  const account = new AccountPanel(
    auth,
    {
      snapshot: () => local.snapshotForImport(),
      clear: () => local.clearSave(),
    },
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
            pendingDrawKey = `molehang.pendingDraw.ship.${shipId}`;
            // 계정 배는 브라우저를 껐다 켜도 남는다 — 복구 기록도 같이 남긴다
            pendingDrawStore = () => globalThis.localStorage;
          }
        }
      } catch (err) {
        console.warn('[molehang] 클라우드 세이브를 쓰지 못해 게스트로 시작합니다', err);
      }
    }
    account.renderChip();

    // 디버그: 방치 시간 강제 (`?away=26` — 시간 단위). 방치 컨텐츠를 바로 본다
    const away = params.get('away');
    if (away !== null) {
      const hours = Number.parseFloat(away);
      if (Number.isFinite(hours) && hours > 0) game.debugOfflineMs = hours * 3600_000;
    }

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

    // 디버그: 테마 강제 (`?theme=ember`)
    const theme = params.get('theme');
    if (theme !== null && isThemeId(theme)) {
      await game.debugGrantTheme(theme);
      snap = game.snapshot();
    }

    // 디버그: 배율 강제 (`?zoom=0.4`) — 스크린샷이 망원경 양 끝을 찍을 수 있게
    const zoom = params.get('zoom');
    if (zoom !== null) {
      const value = Number.parseFloat(zoom);
      if (Number.isFinite(value)) world.setZoom(value);
    }

    applyStatic();
    arrangeUi.refreshLabels();
    voyageUi.refreshLabels();
    telescopeUi.render(world.zoom);
    paint(snap);
    world.start();
    crew.start(params, profileFrom(snap));

    // 디버그: 항해모드로 시작 (`?voyage=1`) — 스크린샷용
    if (params.has('voyage')) voyageUi.open();

    // 방치 컨텐츠 — 비운 사이 배에 생긴 일을 하나씩 알린다
    game.lastIdleGrowth.forEach((growth, i) => {
      globalThis.setTimeout(
        () => toasts.note(t(`idle.${growth.kind}`, { n: growth.count })),
        800 + i * 900,
      );
    });
    game.lastIdleTitleIds.forEach((id, i) => {
      const title = game.titleById(id);
      if (title !== null) {
        globalThis.setTimeout(
          () => toasts.title(title),
          800 + (game.lastIdleGrowth.length + i) * 900,
        );
      }
    });

    globalThis.setInterval(() => paint(game.snapshot()), 250);

    game.onCollect(() => void sheet.refresh());
    game.onGift((gift) => {
      paint(game.snapshot());
      toasts.gift(gift);
      void sheet.refresh();
    });

    if (!params.has('notutorial')) tutorial.autoStart();

    // 지난 세션에서 뽑아 놓고 장착하지 못한 부품이 있으면 결과 화면부터 다시 띄운다
    const savedDraw = takePendingDraw();
    if (savedDraw !== null) {
      const s = game.snapshot();
      const free = s.slotsMax - s.slotsUsed;
      gacha.resume(
        PART_INFO[savedDraw].tier,
        savedDraw,
        PART_INFO[savedDraw].slots > free,
        removableKinds(s.parts).sort((a, b) => PART_INFO[b].slots - PART_INFO[a].slots),
      );
    }

    window.__MOLEHANG_READY__ = true;
  })();

  window.molehang = {
    setHour: (hour) => world.setTimeSource(new FixedTimeOfDay(hour)),
    setPhase: (phase) => world.setTimeSource(new FixedTimeOfDay(PHASE_ANCHOR_HOUR[phase])),
    setZoom: (zoom) => {
      world.setZoom(zoom);
      telescopeUi.render(world.zoom);
    },
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
    async setPlacement(key, position) {
      await game.savePlacement(key, position);
      paint(game.snapshot());
    },
    partScreenPositions: () => world.partScreenPositions(),
    partPlacements: () => world.partPlacements(),
    async drawTheme() {
      const result = await game.drawTheme();
      if (result.drawn !== null) world.setTheme(result.drawn);
      paint(game.snapshot());
    },
    collect: onCollect,
    async draw(tier) {
      await gacha.open(tier, game.snapshot());
    },
    crewMultiplier: () => game.snapshot().crewMultiplier,
    voyage: (active) => {
      if (active) voyageUi.open();
      else voyageUi.close();
    },
    async reset() {
      clearPendingDraw();
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
