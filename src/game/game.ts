import type { Clock } from '../core/clock.ts';
import type { CrewChannel } from '../net/crew-channel.ts';
import { accrue, capacityFor, fillRatio } from './accrual.ts';
import { GAME_CONFIG, type GameConfig } from './config.ts';
import { crewMultiplier, type CrewGift, type CrewMember } from './crew.ts';
import type {
  CollectLogEntry,
  InstallOutcome,
  MolehangGateway,
  PersistedState,
} from './gateway.ts';
import {
  PART_INFO,
  SHIP_TITLES,
  currentTitle,
  emptyInventory,
  gachaCost,
  lightLevel,
  maxSlots,
  productionPerSecond,
  removableKinds,
  totalParts,
  usedSlots,
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
  partCount: number;
  slotsUsed: number;
  slotsMax: number;
  /** 밤에 배를 밝히는 총량 */
  light: number;
  title: ShipTitle;
  unlockedTitles: string[];
  /** 등급별 다음 뽑기 가격 */
  costs: Record<PartTier, number>;

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
  snapshot: GameSnapshot;
}

export class Game {
  private persisted: PersistedState;
  private ready = false;
  private writeTimer: ReturnType<typeof setInterval> | null = null;
  private crew: CrewMember[] = [];

  private readonly collectListeners = new Set<(e: CollectEvent) => void>();
  private readonly changeListeners = new Set<(s: GameSnapshot) => void>();
  private readonly giftListeners = new Set<(g: CrewGift) => void>();

  constructor(
    private readonly gateway: MolehangGateway,
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
      titles: [],
      log: [],
    };
  }

  async start(): Promise<GameSnapshot> {
    this.persisted = await this.gateway.load();
    this.ready = true;

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
    this.persisted = await this.gateway.sync(this.clock.now(), this.multiplier());
  }

  multiplier(): number {
    return crewMultiplier(this.crew.length + 1);
  }

  snapshot(): GameSnapshot {
    const now = this.clock.now();
    const parts = this.persisted.parts;
    const basePerSecond = productionPerSecond(parts, this.config.baseProduction);
    const perSecond = basePerSecond * this.multiplier();
    const capacity = capacityFor(basePerSecond, this.config);

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
      partCount: totalParts(parts),
      slotsUsed: usedSlots(parts),
      slotsMax: maxSlots(parts, this.config.baseSlots),
      light: lightLevel(parts),
      title: currentTitle(parts),
      unlockedTitles: this.persisted.titles,
      costs: {
        small: gachaCost('small', this.persisted.pulls.small),
        medium: gachaCost('medium', this.persisted.pulls.medium),
        large: gachaCost('large', this.persisted.pulls.large),
      },

      crew: this.crew,
      crewSize: this.crew.length + 1,
      crewMultiplier: this.multiplier(),
    };
  }

  async collect(): Promise<CollectEvent | null> {
    if (!this.ready) return null;
    const outcome = await this.gateway.collect(this.clock.now(), this.multiplier());
    this.persisted = outcome.state;

    const snap = this.snapshot();
    this.emitChange(snap);
    if (outcome.taken <= 0 || outcome.entry === null) return null;

    this.channel?.announceCollect(outcome.taken, []);

    const event: CollectEvent = { amount: outcome.taken, entry: outcome.entry, snapshot: snap };
    for (const fn of this.collectListeners) fn(event);
    return event;
  }

  /** 뽑기. 고철이 모자라면 null */
  async draw(tier: PartTier): Promise<DrawEvent | null> {
    if (!this.ready) return null;
    const outcome = await this.gateway.draw(tier, this.clock.now());
    this.persisted = outcome.state;
    this.emitChange(this.snapshot());
    if (outcome.drawn === null) return null;

    return {
      drawn: outcome.drawn,
      needsRoom: outcome.needsRoom,
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
    const outcome = await this.gateway.install(kind, remove, this.clock.now());
    this.persisted = outcome.state;
    this.emitChange(this.snapshot());
    return outcome;
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

  private async applyGift(gift: CrewGift): Promise<void> {
    if (!this.ready) return;
    this.persisted = await this.gateway.receiveGift(this.clock.now(), gift.scrap);
    this.emitChange(this.snapshot());
    for (const fn of this.giftListeners) fn(gift);
  }

  private emitChange(s: GameSnapshot): void {
    for (const fn of this.changeListeners) fn(s);
  }
}
