import { accrue, collectFrom } from './accrual.ts';
import { GAME_CONFIG, STORAGE_KEY, type GameConfig } from './config.ts';
import type {
  CollectLogEntry,
  CollectOutcome,
  MolehangGateway,
  PersistedState,
} from './gateway.ts';
import {
  emptyInventory,
  rollParts,
  sanitizeInventory,
  unlockedTitleIds,
  type PartKind,
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
    const result = accrue(
      { lastAccruedAt: this.state.lastAccruedAt, stored: this.state.stored, now, multiplier },
      this.config,
    );
    this.state.stored = result.stored;
    this.state.lastAccruedAt = now;
    this.write();
    return this.snapshot();
  }

  /** 친구 수거 배당 — 상한을 넘지 않게 얹는다 */
  async receiveGift(
    now: number,
    resource: number,
    part: PartKind | null,
  ): Promise<PersistedState> {
    await this.sync(now, 1);
    this.state.stored = Math.min(this.config.capacity, this.state.stored + Math.max(0, resource));
    if (part !== null) {
      this.state.parts[part] += 1;
      this.state.titles = [
        ...new Set([...this.state.titles, ...unlockedTitleIds(this.state.parts)]),
      ];
    }
    this.write();
    return this.snapshot();
  }

  async collect(now: number, multiplier = 1): Promise<CollectOutcome> {
    await this.sync(now, multiplier);
    const { taken, left } = collectFrom(this.state.stored, this.config);

    if (taken <= 0) {
      return { state: this.snapshot(), taken: 0, entry: null, gainedParts: [], newTitleId: null };
    }

    // 얻은 파츠는 고를 수 없다 — 전부 그대로 배에 붙는다
    const gained: PartKind[] = rollParts(taken, this.config.capacity, this.rand);
    for (const kind of gained) this.state.parts[kind] += 1;

    const before = new Set(this.state.titles);
    const nowUnlocked = unlockedTitleIds(this.state.parts);
    const fresh = nowUnlocked.filter((id) => !before.has(id));
    this.state.titles = [...new Set([...this.state.titles, ...nowUnlocked])];

    const entry: CollectLogEntry = {
      id: `${now.toString(36)}-${Math.floor(this.rand() * 1e6).toString(36)}`,
      at: now,
      amount: taken,
      total: this.state.lifetime + taken,
      sinceMs: this.state.lastCollectedAt === null ? null : now - this.state.lastCollectedAt,
      parts: gained,
    };

    this.state.stored = left;
    this.state.lifetime = entry.total;
    this.state.lastCollectedAt = now;
    this.state.log.unshift(entry);
    if (this.state.log.length > this.config.logLimit) {
      this.state.log.length = this.config.logLimit;
    }
    this.write();

    return {
      state: this.snapshot(),
      taken,
      entry,
      gainedParts: gained,
      // 여러 개가 동시에 열리면 가장 희귀한(마지막) 것을 보여준다
      newTitleId: fresh.length > 0 ? fresh[fresh.length - 1]! : null,
    };
  }

  async log(limit = this.config.logLimit): Promise<CollectLogEntry[]> {
    return this.state.log.slice(0, limit).map((e) => ({ ...e, parts: [...e.parts] }));
  }

  async reset(): Promise<PersistedState> {
    this.state = fresh(Date.now());
    this.write();
    return this.snapshot();
  }

  /** 데모/디버그 전용 — `?res=` / `?parts=` 처리에 쓴다 */
  async debugSetStored(amount: number): Promise<PersistedState> {
    this.state.stored = Math.max(0, Math.min(this.config.capacity, amount));
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

  private snapshot(): PersistedState {
    return {
      ...this.state,
      parts: { ...this.state.parts },
      titles: [...this.state.titles],
      log: this.state.log.map((e) => ({ ...e, parts: [...e.parts] })),
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
        stored: num(parsed.stored, 0),
        lifetime: num(parsed.lifetime, 0),
        lastCollectedAt:
          typeof parsed.lastCollectedAt === 'number' && Number.isFinite(parsed.lastCollectedAt)
            ? parsed.lastCollectedAt
            : null,
        parts: sanitizeInventory(parsed.parts),
        titles: Array.isArray(parsed.titles)
          ? parsed.titles.filter((t): t is string => typeof t === 'string')
          : [],
        log: Array.isArray(parsed.log) ? parsed.log.filter(isEntry).map(normalizeEntry) : [],
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
    stored: 0,
    lifetime: 0,
    lastCollectedAt: null,
    parts: emptyInventory(),
    titles: [],
    log: [],
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isEntry(v: unknown): v is CollectLogEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<CollectLogEntry>;
  return typeof e.id === 'string' && typeof e.at === 'number' && typeof e.amount === 'number';
}

/** 파츠 시스템 이전 저장본과의 호환 */
function normalizeEntry(e: CollectLogEntry): CollectLogEntry {
  return { ...e, parts: Array.isArray(e.parts) ? e.parts : [] };
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
