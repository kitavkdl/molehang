import type { Clock } from '../core/clock.ts';
import type { CrewChannel } from '../net/crew-channel.ts';
import { accrue, fillRatio } from './accrual.ts';
import { GAME_CONFIG, type GameConfig } from './config.ts';
import { crewMultiplier, type CrewGift, type CrewMember } from './crew.ts';
import type { CollectLogEntry, MolehangGateway, PersistedState } from './gateway.ts';
import {
  SHIP_TITLES,
  currentTitle,
  emptyInventory,
  totalParts,
  type Inventory,
  type PartKind,
  type ShipTitle,
} from './parts.ts';

export interface GameSnapshot {
  /** 지금 이 순간의 보유량 (게이트웨이 정산 + 프레임 보간) */
  stored: number;
  capacity: number;
  /** 0~1 */
  fill: number;
  /** 상한까지 남은 ms. 가득이면 0 */
  msUntilFull: number;
  lifetime: number;
  lastCollectedAt: number | null;
  canCollect: boolean;
  /** 배에 붙어 있는 파츠 */
  parts: Inventory;
  partCount: number;
  /** 현재 칭호 (파츠 구성에서 계산) */
  title: ShipTitle;
  /** 한 번이라도 달성한 칭호 id */
  unlockedTitles: string[];
  /** 같이 접속해 있는 선원 (본인 제외) */
  crew: CrewMember[];
  /** 본인 포함 인원 */
  crewSize: number;
  /** 선단 축적 배율 (1 = 혼자) */
  crewMultiplier: number;
}

export interface CollectEvent {
  amount: number;
  entry: CollectLogEntry;
  snapshot: GameSnapshot;
  gainedParts: PartKind[];
  newTitle: ShipTitle | null;
}

/**
 * 게이트웨이(느린 영속 저장)와 화면(매 프레임) 사이의 얇은 층.
 *
 * 매 프레임 저장소를 때리지 않으려고, 마지막 정산 스냅샷 위에서
 * 같은 순수 함수 accrue() 로 로컬 보간만 한다. 진실은 항상 게이트웨이 쪽에 있다.
 */
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
      stored: 0,
      lifetime: 0,
      lastCollectedAt: null,
      parts: emptyInventory(),
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

    // 주기적으로만 영속화한다 (탭이 오래 열려 있어도 저장 시각이 크게 안 밀리게).
    this.writeTimer = setInterval(() => {
      void this.flush();
    }, 15_000);

    const onHide = () => {
      if (document.visibilityState === 'hidden') void this.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    globalThis.addEventListener('pagehide', () => void this.flush());

    const snap = this.snapshot();
    this.emitChange(snap);
    return snap;
  }

  dispose(): void {
    if (this.writeTimer !== null) clearInterval(this.writeTimer);
    this.writeTimer = null;
  }

  /** 게이트웨이에 현재 시각까지 정산해 저장 */
  async flush(): Promise<void> {
    if (!this.ready) return;
    this.persisted = await this.gateway.sync(this.clock.now(), this.multiplier());
  }

  /** 지금 붙어 있는 선단 배율 */
  multiplier(): number {
    return crewMultiplier(this.crew.length + 1);
  }

  private async applyGift(gift: CrewGift): Promise<void> {
    if (!this.ready) return;
    this.persisted = await this.gateway.receiveGift(
      this.clock.now(),
      gift.resource,
      gift.part,
    );
    this.emitChange(this.snapshot());
    for (const fn of this.giftListeners) fn(gift);
  }

  snapshot(): GameSnapshot {
    const now = this.clock.now();
    const result = accrue(
      {
        lastAccruedAt: this.persisted.lastAccruedAt,
        stored: this.persisted.stored,
        now,
        multiplier: this.multiplier(),
      },
      this.config,
    );

    return {
      stored: result.stored,
      capacity: this.config.capacity,
      fill: fillRatio(result.stored, this.config),
      msUntilFull: result.msUntilFull,
      lifetime: this.persisted.lifetime,
      lastCollectedAt: this.persisted.lastCollectedAt,
      canCollect: Math.floor(result.stored) >= this.config.minCollect,
      parts: this.persisted.parts,
      partCount: totalParts(this.persisted.parts),
      title: currentTitle(this.persisted.parts),
      unlockedTitles: this.persisted.titles,
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

    // 선단에 알린다 — 받는 쪽이 각자 자기 몫을 굴린다
    this.channel?.announceCollect(outcome.taken, outcome.gainedParts);

    const event: CollectEvent = {
      amount: outcome.taken,
      entry: outcome.entry,
      snapshot: snap,
      gainedParts: outcome.gainedParts,
      newTitle:
        outcome.newTitleId === null
          ? null
          : (SHIP_TITLES.find((t) => t.id === outcome.newTitleId) ?? null),
    };
    for (const fn of this.collectListeners) fn(event);
    return event;
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

  /** 디버그: 보유량 강제 세팅 (`?res=`) */
  async debugSetStored(amount: number): Promise<void> {
    const gw = this.gateway as MolehangGateway & {
      debugSetStored?: (n: number) => Promise<PersistedState>;
    };
    if (typeof gw.debugSetStored !== 'function') return;
    this.persisted = await gw.debugSetStored(amount);
    this.emitChange(this.snapshot());
  }

  /** 디버그: 파츠 강제 장착 (`?parts=`) */
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

  /** 친구가 보낸 선물이 도착했을 때 */
  onGift(fn: (g: CrewGift) => void): () => void {
    this.giftListeners.add(fn);
    return () => this.giftListeners.delete(fn);
  }

  private emitChange(s: GameSnapshot): void {
    for (const fn of this.changeListeners) fn(s);
  }
}
