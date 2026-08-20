import type { Clock } from '../core/clock.ts';
import type { CrewChannel } from '../net/crew-channel.ts';
import { accrue, capacityFor, fillRatio } from './accrual.ts';
import { GAME_CONFIG, type GameConfig } from './config.ts';
import { THEMES, THEME_IDS, themeCost, type ThemeId } from '../style/themes.ts';
import {
  comboScrap,
  crewMultiplier,
  isCombo,
  tailwindChance,
  type CrewGift,
  type CrewMember,
} from './crew.ts';
import type {
  CollectLogEntry,
  InstallOutcome,
  MolehangGateway,
  PersistedState,
} from './gateway.ts';
import { idleGrowth, type IdleGrowth } from './idle.ts';
import {
  PART_INFO,
  SHIP_TITLES,
  capacityBoost,
  currentTitle,
  emptyInventory,
  gachaCost,
  gachaDiscount,
  lightLevel,
  maxSlots,
  productionPerSecond,
  removableKinds,
  totalParts,
  usedSlots,
  voyageSpeedBonus,
  type Inventory,
  type PartKind,
  type PartTier,
  type ShipTitle,
} from './parts.ts';

export interface GameSnapshot {
  /** 아직 수거하지 않고 쌓여 있는 고철 */
  pending: number;
  /** 뽑기에 쓸 수 있는 잔고 */
  scrap: number;
  capacity: number;
  /** 0~1 */
  fill: number;
  /** 초당 생산량 (선단 보너스 포함) */
  perSecond: number;
  /** 상한까지 남은 ms. 가득이면 0 */
  msUntilFull: number;
  lifetime: number;
  canCollect: boolean;

  parts: Inventory;
  /** 사용자가 끌어 놓은 부품 위치 */
  placements: Record<string, [number, number, number]>;
  partCount: number;
  slotsUsed: number;
  slotsMax: number;
  /** 밤에 배를 밝히는 총량 */
  light: number;
  /** 항해모드 속도 보너스 (부품 효과 합산) */
  voyageSpeed: number;
  title: ShipTitle;
  unlockedTitles: string[];
  /** 등급별 다음 뽑기 가격 */
  costs: Record<PartTier, number>;
  /** 지금 쓰는 바다 테마 */
  theme: ThemeId;
  themes: ThemeId[];
  themeCost: number;
  /** 더 뽑을 테마가 남았는지 */
  themesLeft: number;

  crew: CrewMember[];
  crewSize: number;
  crewMultiplier: number;
}

export interface CollectEvent {
  amount: number;
  entry: CollectLogEntry;
  snapshot: GameSnapshot;
}

export interface DrawEvent {
  drawn: PartKind;
  /** 자리가 모자라 교체 결정이 필요한 상태 */
  needsRoom: boolean;
  /** 자리를 비우려고 뺄 수 있는 후보 */
  removable: PartKind[];
  /** 순풍(선단 보너스) — 낸 값보다 한 등급 위 돌림판에서 뽑혔는지 */
  luckyTier: boolean;
  snapshot: GameSnapshot;
}

/** 만선 콤보 — 친구와 60초 안에 서로 수거했다 (game/crew.ts) */
export interface CrewComboEvent {
  /** 내 수거량에 얹어 받은 보너스 고철 */
  bonus: number;
  /** 같은 물때를 잡은 친구 이름 */
  withName: string;
}

export class Game {
  private persisted: PersistedState;
  private ready = false;
  private writeTimer: ReturnType<typeof setInterval> | null = null;
  private crew: CrewMember[] = [];

  /** 이번 부팅에서 저절로 붙은 방치 부품들 — main 이 읽어 토스트로 알린다 */
  lastIdleGrowth: IdleGrowth[] = [];
  /** 방치 부품 장착으로 처음 달성한 칭호 id 들 */
  lastIdleTitleIds: string[] = [];
  /** 디버그(`?away=`) — 오프라인 시간을 강제한다. null 이면 게이트웨이 값 */
  debugOfflineMs: number | null = null;

  /**
   * 게이트웨이 변이 직렬화 큐.
   *
   * 로그인 상태의 게이트웨이는 네트워크를 탄다 — 수거 연타, 수거와 선물 배당,
   * 따개비 장착과 뽑기 장착이 **겹치면** 서로의 결과를 덮어쓴다
   * (같은 pending 을 두 번 지갑에 넣거나, 마지막 push 가 이긴다).
   * 상태를 바꾸는 호출은 전부 이 줄에 세워 한 번에 하나만 달리게 한다.
   * 로컬 게이트웨이는 어차피 즉시 끝나서 줄 서는 비용이 없다.
   */
  private chain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private readonly collectListeners = new Set<(e: CollectEvent) => void>();
  private readonly changeListeners = new Set<(s: GameSnapshot) => void>();
  private readonly giftListeners = new Set<(g: CrewGift) => void>();
  private readonly comboListeners = new Set<(e: CrewComboEvent) => void>();

  /**
   * 만선 콤보(§4.3) 추적 — 내 마지막 수거와 친구의 마지막 수거(=배당 도착)를 붙잡아 두고,
   * 두 시각이 60초 창 안에 겹치면 내 수거량의 30%를 보너스로 받는다.
   * 각 수거는 콤보를 **한 번만** 만든다 — comboed 플래그가 이중 지급을 막는다.
   */
  private lastOwnCollect: { at: number; amount: number; comboed: boolean } | null = null;
  private lastMateCollect: { at: number; name: string; comboed: boolean } | null = null;

  constructor(
    private gateway: MolehangGateway,
    private readonly clock: Clock,
    private readonly config: GameConfig = GAME_CONFIG,
    private readonly channel: CrewChannel | null = null,
  ) {
    this.persisted = {
      lastAccruedAt: clock.now(),
      pending: 0,
      scrap: 0,
      lifetime: 0,
      lastCollectedAt: null,
      parts: emptyInventory(),
      pulls: { small: 0, medium: 0, large: 0 },
      placements: {},
      titles: [],
      theme: 'classic',
      themes: ['classic'],
      themePulls: 0,
      log: [],
    };
  }

  /** 부팅 도중 클라우드 세이브로 갈아탄다 (start() 전에만) */
  useGateway(next: MolehangGateway): void {
    if (this.ready) throw new Error('[molehang] 시작한 뒤에는 게이트웨이를 바꿀 수 없습니다');
    this.gateway = next;
  }

  async start(): Promise<GameSnapshot> {
    this.persisted = await this.gateway.load();
    this.ready = true;

    // 방치 컨텐츠 — 오래 비운 배에는 이끼·둥지·유령이 저절로 붙는다 (idle.ts)
    await this.applyIdleGrowth();

    if (this.channel !== null) {
      this.channel.onPresence((members) => {
        this.crew = members;
        this.emitChange(this.snapshot());
      });
      this.channel.onGift((gift) => void this.applyGift(gift));
    }

    this.writeTimer = setInterval(() => void this.flush(), 15_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
    globalThis.addEventListener('pagehide', () => void this.flush());

    const snap = this.snapshot();
    this.emitChange(snap);
    return snap;
  }

  dispose(): void {
    if (this.writeTimer !== null) clearInterval(this.writeTimer);
    this.writeTimer = null;
  }

  async flush(): Promise<void> {
    if (!this.ready) return;
    await this.enqueue(async () => {
      this.persisted = await this.gateway.sync(this.clock.now(), this.multiplier());
    });
  }

  multiplier(): number {
    return crewMultiplier(this.crew.length + 1);
  }

  /**
   * 마지막 정산 이후 흐른 시간으로 방치 부품을 붙인다.
   * 장착은 게이트웨이 install 을 그대로 태운다 — 칭호 판정·저장 경로가 뽑기와 같아진다.
   */
  private async applyIdleGrowth(): Promise<void> {
    const parts = this.persisted.parts;
    const offline = this.debugOfflineMs ?? this.gateway.offlineMs();
    const growth = idleGrowth(offline, parts);

    for (const item of growth) {
      for (let i = 0; i < item.count; i++) {
        const outcome = await this.gateway.install(item.kind, null, this.clock.now(), 1);
        this.persisted = outcome.state;
        if (outcome.newTitleId !== null) this.lastIdleTitleIds.push(outcome.newTitleId);
      }
    }
    this.lastIdleGrowth = growth;
  }

  snapshot(): GameSnapshot {
    const now = this.clock.now();
    const parts = this.persisted.parts;
    const basePerSecond = productionPerSecond(parts, this.config.baseProduction);
    const perSecond = basePerSecond * this.multiplier();
    const capacity = capacityFor(basePerSecond, this.config, capacityBoost(parts));

    const result = accrue(
      {
        lastAccruedAt: this.persisted.lastAccruedAt,
        pending: this.persisted.pending,
        now,
        perSecond: basePerSecond,
        capacity,
        multiplier: this.multiplier(),
      },
      this.config,
    );

    return {
      pending: result.pending,
      scrap: this.persisted.scrap,
      capacity,
      fill: fillRatio(result.pending, capacity),
      perSecond,
      msUntilFull: result.msUntilFull,
      lifetime: this.persisted.lifetime,
      canCollect: Math.floor(result.pending) >= this.config.minCollect,

      parts,
      placements: this.persisted.placements,
      partCount: totalParts(parts),
      slotsUsed: usedSlots(parts),
      slotsMax: maxSlots(parts, this.config.baseSlots),
      light: lightLevel(parts),
      voyageSpeed: voyageSpeedBonus(parts),
      title: currentTitle(parts),
      unlockedTitles: this.persisted.titles,
      costs: {
        small: gachaCost('small', this.persisted.pulls.small, gachaDiscount(parts)),
        medium: gachaCost('medium', this.persisted.pulls.medium, gachaDiscount(parts)),
        large: gachaCost('large', this.persisted.pulls.large, gachaDiscount(parts)),
      },
      theme: this.persisted.theme,
      themes: this.persisted.themes,
      themeCost: themeCost(this.persisted.themePulls),
      themesLeft: THEME_IDS.filter(
        (id) => THEMES[id].weight > 0 && !this.persisted.themes.includes(id),
      ).length,

      crew: this.crew,
      crewSize: this.crew.length + 1,
      crewMultiplier: this.multiplier(),
    };
  }

  async collect(): Promise<CollectEvent | null> {
    if (!this.ready) return null;
    const outcome = await this.enqueue(() =>
      this.gateway.collect(this.clock.now(), this.multiplier()),
    );
    this.persisted = outcome.state;

    const snap = this.snapshot();
    this.emitChange(snap);
    if (outcome.taken <= 0 || outcome.entry === null) return null;

    this.channel?.announceCollect(outcome.taken, []);

    // 만선 콤보 — 친구가 방금(60초 안에) 수거했다면 이 수거가 콤보를 완성한다
    const now = this.clock.now();
    this.lastOwnCollect = { at: now, amount: outcome.taken, comboed: false };
    if (
      this.lastMateCollect !== null &&
      !this.lastMateCollect.comboed &&
      isCombo(now, this.lastMateCollect.at)
    ) {
      await this.fireCombo(this.lastMateCollect.name);
    }

    const event: CollectEvent = {
      amount: outcome.taken,
      entry: outcome.entry,
      snapshot: this.snapshot(),
    };
    for (const fn of this.collectListeners) fn(event);
    return event;
  }

  /** 만선 콤보 지급 — 내 수거량의 30%를 보너스 고철로. 양쪽 수거를 소진 처리한다 */
  private async fireCombo(withName: string): Promise<void> {
    if (this.lastOwnCollect === null || this.lastMateCollect === null) return;
    this.lastOwnCollect.comboed = true;
    this.lastMateCollect.comboed = true;

    const bonus = comboScrap(this.lastOwnCollect.amount);
    // 배당과 같은 경로(receiveGift)를 탄다 — 새 변이 경로를 만들지 않는다 (§4.12)
    this.persisted = await this.enqueue(() =>
      this.gateway.receiveGift(this.clock.now(), bonus, this.multiplier()),
    );
    this.emitChange(this.snapshot());
    for (const fn of this.comboListeners) fn({ bonus, withName });
  }

  /** 뽑기. 고철이 모자라면 null */
  async draw(tier: PartTier): Promise<DrawEvent | null> {
    if (!this.ready) return null;
    // 순풍(§4.3) — 같이 접속해 있는 동안에만 확률이 붙는다. 혼자면 0.
    const outcome = await this.enqueue(() =>
      this.gateway.draw(
        tier,
        this.clock.now(),
        this.multiplier(),
        tailwindChance(this.crew.length + 1),
      ),
    );
    this.persisted = outcome.state;
    this.emitChange(this.snapshot());
    if (outcome.drawn === null) return null;

    return {
      drawn: outcome.drawn,
      needsRoom: outcome.needsRoom,
      luckyTier: outcome.luckyTier,
      // 뽑힌 것보다 자리를 많이 차지하는 것부터 보여 주면 결정이 쉬워진다
      removable: removableKinds(this.persisted.parts).sort(
        (a, b) => PART_INFO[b].slots - PART_INFO[a].slots,
      ),
      snapshot: this.snapshot(),
    };
  }

  /** 장착 확정. 자리가 모자랐다면 remove 로 하나 빼고 넣는다 */
  async install(kind: PartKind, remove: PartKind | null = null): Promise<InstallOutcome | null> {
    if (!this.ready) return null;
    const outcome = await this.enqueue(() =>
      this.gateway.install(kind, remove, this.clock.now(), this.multiplier()),
    );
    this.persisted = outcome.state;
    this.emitChange(this.snapshot());
    return outcome;
  }

  /** 테마 뽑기. null 이면 고철이 모자라거나(soldOut=false) 이미 다 모았다(true) */
  async drawTheme(): Promise<{ drawn: ThemeId | null; soldOut: boolean }> {
    if (!this.ready) return { drawn: null, soldOut: false };
    const outcome = await this.enqueue(() => this.gateway.drawTheme());
    this.persisted = outcome.state;
    this.emitChange(this.snapshot());
    return { drawn: outcome.drawn, soldOut: outcome.soldOut };
  }

  async setTheme(id: ThemeId): Promise<void> {
    if (!this.ready) return;
    this.persisted = await this.enqueue(() => this.gateway.setTheme(id));
    this.emitChange(this.snapshot());
  }

  /** 디버그: 테마를 뽑지 않고 지급 (`?theme=`) */
  async debugGrantTheme(id: ThemeId): Promise<void> {
    const gw = this.gateway as MolehangGateway & {
      debugGrantTheme?: (t: ThemeId) => Promise<PersistedState>;
    };
    if (typeof gw.debugGrantTheme !== 'function') return;
    this.persisted = await gw.debugGrantTheme(id);
    this.emitChange(this.snapshot());
  }

  /** 끌어 놓은 자리를 저장한다 (드래그가 끝날 때마다) */
  async savePlacement(key: string, position: [number, number, number]): Promise<void> {
    if (!this.ready) return;
    // placements 는 큐 **안에서** 읽는다 — 앞선 저장이 끝난 최신 상태 위에 얹기 위해
    this.persisted = await this.enqueue(() =>
      this.gateway.setPlacements({
        ...this.persisted.placements,
        [key]: position,
      }),
    );
    this.emitChange(this.snapshot());
  }

  /** 전부 기본 격자 자리로 되돌린다 */
  async resetPlacements(): Promise<void> {
    if (!this.ready) return;
    this.persisted = await this.enqueue(() => this.gateway.setPlacements({}));
    this.emitChange(this.snapshot());
  }

  titleById(id: string | null): ShipTitle | null {
    return id === null ? null : (SHIP_TITLES.find((t) => t.id === id) ?? null);
  }

  async log(limit?: number): Promise<CollectLogEntry[]> {
    return this.gateway.log(limit);
  }

  async reset(): Promise<GameSnapshot> {
    this.persisted = await this.gateway.reset();
    const snap = this.snapshot();
    this.emitChange(snap);
    return snap;
  }

  async debugSetScrap(amount: number): Promise<void> {
    const gw = this.gateway as MolehangGateway & {
      debugSetScrap?: (n: number) => Promise<PersistedState>;
    };
    if (typeof gw.debugSetScrap !== 'function') return;
    this.persisted = await gw.debugSetScrap(amount);
    this.emitChange(this.snapshot());
  }

  async debugSetPending(amount: number): Promise<void> {
    const gw = this.gateway as MolehangGateway & {
      debugSetPending?: (n: number) => Promise<PersistedState>;
    };
    if (typeof gw.debugSetPending !== 'function') return;
    this.persisted = await gw.debugSetPending(amount);
    this.emitChange(this.snapshot());
  }

  async debugAddParts(kinds: PartKind[]): Promise<void> {
    const gw = this.gateway as MolehangGateway & {
      debugAddParts?: (k: PartKind[]) => Promise<PersistedState>;
    };
    if (typeof gw.debugAddParts !== 'function') return;
    this.persisted = await gw.debugAddParts(kinds);
    this.emitChange(this.snapshot());
  }

  onCollect(fn: (e: CollectEvent) => void): () => void {
    this.collectListeners.add(fn);
    return () => this.collectListeners.delete(fn);
  }

  onChange(fn: (s: GameSnapshot) => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onGift(fn: (g: CrewGift) => void): () => void {
    this.giftListeners.add(fn);
    return () => this.giftListeners.delete(fn);
  }

  onCombo(fn: (e: CrewComboEvent) => void): () => void {
    this.comboListeners.add(fn);
    return () => this.comboListeners.delete(fn);
  }

  private async applyGift(gift: CrewGift): Promise<void> {
    if (!this.ready) return;
    this.persisted = await this.enqueue(() =>
      this.gateway.receiveGift(this.clock.now(), gift.scrap, this.multiplier()),
    );
    this.emitChange(this.snapshot());
    for (const fn of this.giftListeners) fn(gift);

    // 배당 도착 = 친구가 방금 수거했다. 내가 60초 안에 수거했었다면 콤보 완성 —
    // 양쪽 탭이 같은 규칙으로 각자 판정하므로 서로에게 다시 알릴 필요가 없다.
    const now = this.clock.now();
    this.lastMateCollect = { at: now, name: gift.fromName, comboed: false };
    if (
      this.lastOwnCollect !== null &&
      !this.lastOwnCollect.comboed &&
      isCombo(this.lastOwnCollect.at, now)
    ) {
      await this.fireCombo(gift.fromName);
    }
  }

  private emitChange(s: GameSnapshot): void {
    for (const fn of this.changeListeners) fn(s);
  }
}
