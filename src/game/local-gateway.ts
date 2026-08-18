import { accrue, capacityFor, collectFrom } from './accrual.ts';
import { GAME_CONFIG, STORAGE_KEY, type GameConfig } from './config.ts';
import type {
  CollectLogEntry,
  CollectOutcome,
  DrawOutcome,
  InstallOutcome,
  MolehangGateway,
  PersistedState,
} from './gateway.ts';
import {
  PART_INFO,
  PART_TIERS,
  emptyInventory,
  gachaCost,
  maxSlots,
  productionPerSecond,
  rollPart,
  sanitizeInventory,
  unlockedTitleIds,
  usedSlots,
  type PartKind,
  type PartTier,
} from './parts.ts';

/**
 * localStorage 구현.
 *
 * "마지막 정산 시각"만 저장해 두면 앱이 꺼져 있던 동안의 축적도
 * 다음 부팅 때 accrue() 한 번으로 그대로 재현된다 = 오프라인 축적.
 */
export class LocalGateway implements MolehangGateway {
  private state: PersistedState;

  constructor(
    private readonly config: GameConfig = GAME_CONFIG,
    private readonly storage: Storage | null = safeStorage(),
    private readonly rand: () => number = Math.random,
    private readonly storageKey: string = STORAGE_KEY,
  ) {
    this.state = this.read();
  }

  async load(): Promise<PersistedState> {
    // 오프라인 구간에는 선단 보너스를 주지 않는다 — 같이 있을 때만 붙는 값이다
    return this.sync(Date.now(), 1);
  }

  async sync(now: number, multiplier = 1): Promise<PersistedState> {
    const perSecond = this.perSecond();
    const result = accrue(
      {
        lastAccruedAt: this.state.lastAccruedAt,
        pending: this.state.pending,
        now,
        perSecond,
        capacity: capacityFor(perSecond, this.config),
        multiplier,
      },
      this.config,
    );
    this.state.pending = result.pending;
    this.state.lastAccruedAt = now;
    this.write();
    return this.snapshot();
  }

  async collect(now: number, multiplier = 1): Promise<CollectOutcome> {
    await this.sync(now, multiplier);
    const { taken, left } = collectFrom(this.state.pending, this.config);

    if (taken <= 0) return { state: this.snapshot(), taken: 0, entry: null };

    const entry: CollectLogEntry = {
      id: `${now.toString(36)}-${Math.floor(this.rand() * 1e6).toString(36)}`,
      at: now,
      amount: taken,
      total: this.state.lifetime + taken,
      sinceMs: this.state.lastCollectedAt === null ? null : now - this.state.lastCollectedAt,
    };

    this.state.pending = left;
    this.state.scrap += taken;
    this.state.lifetime = entry.total;
    this.state.lastCollectedAt = now;
    this.state.log.unshift(entry);
    if (this.state.log.length > this.config.logLimit) {
      this.state.log.length = this.config.logLimit;
    }
    this.write();

    return { state: this.snapshot(), taken, entry };
  }

  async draw(tier: PartTier, now: number): Promise<DrawOutcome> {
    await this.sync(now, 1);
    const cost = gachaCost(tier, this.state.pulls[tier]);
    if (this.state.scrap < cost) {
      return { state: this.snapshot(), drawn: null, needsRoom: false };
    }

    this.state.scrap -= cost;
    this.state.pulls[tier] += 1;
    const drawn = rollPart(tier, this.rand);
    this.write();

    const need = PART_INFO[drawn].slots;
    const free = maxSlots(this.state.parts, this.config.baseSlots) - usedSlots(this.state.parts);
    return { state: this.snapshot(), drawn, needsRoom: need > free };
  }

  async install(kind: PartKind, remove: PartKind | null, now: number): Promise<InstallOutcome> {
    await this.sync(now, 1);

    if (remove !== null && this.state.parts[remove] > 0) {
      this.state.parts[remove] -= 1;
    }
    this.state.parts[kind] += 1;

    const before = new Set(this.state.titles);
    const nowUnlocked = unlockedTitleIds(this.state.parts);
    const fresh = nowUnlocked.filter((id) => !before.has(id));
    this.state.titles = [...new Set([...this.state.titles, ...nowUnlocked])];
    this.write();

    return {
      state: this.snapshot(),
      installed: kind,
      removed: remove,
      newTitleId: fresh.length > 0 ? fresh[fresh.length - 1]! : null,
    };
  }

  async receiveGift(now: number, scrap: number): Promise<PersistedState> {
    await this.sync(now, 1);
    this.state.scrap += Math.max(0, Math.round(scrap));
    this.write();
    return this.snapshot();
  }

  async log(limit = this.config.logLimit): Promise<CollectLogEntry[]> {
    return this.state.log.slice(0, limit).map((e) => ({ ...e }));
  }

  async reset(): Promise<PersistedState> {
    this.state = fresh(Date.now());
    this.write();
    return this.snapshot();
  }

  /** 데모/디버그 전용 */
  async debugSetScrap(amount: number): Promise<PersistedState> {
    this.state.scrap = Math.max(0, amount);
    this.write();
    return this.snapshot();
  }

  async debugSetPending(amount: number): Promise<PersistedState> {
    const cap = capacityFor(this.perSecond(), this.config);
    this.state.pending = Math.max(0, Math.min(cap, amount));
    this.state.lastAccruedAt = Date.now();
    this.write();
    return this.snapshot();
  }

  async debugAddParts(kinds: PartKind[]): Promise<PersistedState> {
    for (const kind of kinds) this.state.parts[kind] += 1;
    this.state.titles = [...new Set([...this.state.titles, ...unlockedTitleIds(this.state.parts)])];
    this.write();
    return this.snapshot();
  }

  /** 게스트로 만든 배를 계정으로 가져갈 때 쓴다 */
  snapshotForImport(): PersistedState {
    return this.snapshot();
  }

  private perSecond(): number {
    return productionPerSecond(this.state.parts, this.config.baseProduction);
  }

  private snapshot(): PersistedState {
    return {
      ...this.state,
      parts: { ...this.state.parts },
      pulls: { ...this.state.pulls },
      titles: [...this.state.titles],
      log: this.state.log.map((e) => ({ ...e })),
    };
  }

  private read(): PersistedState {
    const now = Date.now();
    const raw = this.storage?.getItem(this.storageKey);
    if (!raw) return fresh(now);

    try {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        lastAccruedAt: num(parsed.lastAccruedAt, now),
        pending: num(parsed.pending, 0),
        scrap: num(parsed.scrap, 0),
        lifetime: num(parsed.lifetime, 0),
        lastCollectedAt:
          typeof parsed.lastCollectedAt === 'number' && Number.isFinite(parsed.lastCollectedAt)
            ? parsed.lastCollectedAt
            : null,
        parts: sanitizeInventory(parsed.parts),
        pulls: sanitizePulls(parsed.pulls),
        titles: Array.isArray(parsed.titles)
          ? parsed.titles.filter((t): t is string => typeof t === 'string')
          : [],
        log: Array.isArray(parsed.log) ? parsed.log.filter(isEntry) : [],
      };
    } catch {
      return fresh(now);
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      // 사파리 프라이빗 모드 등 — 저장 실패해도 세션은 계속 굴러가야 한다.
    }
  }
}

function fresh(now: number): PersistedState {
  return {
    lastAccruedAt: now,
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

function sanitizePulls(raw: unknown): Record<PartTier, number> {
  const out: Record<PartTier, number> = { small: 0, medium: 0, large: 0 };
  if (typeof raw !== 'object' || raw === null) return out;
  const src = raw as Record<string, unknown>;
  for (const tier of PART_TIERS) {
    const v = src[tier];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[tier] = Math.floor(v);
  }
  return out;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isEntry(v: unknown): v is CollectLogEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<CollectLogEntry>;
  return typeof e.id === 'string' && typeof e.at === 'number' && typeof e.amount === 'number';
}

function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__mh__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
