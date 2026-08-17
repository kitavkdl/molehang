import { accrue, collectFrom } from './accrual.ts';
import { GAME_CONFIG, STORAGE_KEY, type GameConfig } from './config.ts';
import type {
  CollectLogEntry,
  CollectOutcome,
  MolehangGateway,
  PersistedState,
} from './gateway.ts';

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
  ) {
    this.state = this.read();
  }

  async load(): Promise<PersistedState> {
    return this.sync(Date.now());
  }

  async sync(now: number): Promise<PersistedState> {
    const result = accrue(
      { lastAccruedAt: this.state.lastAccruedAt, stored: this.state.stored, now },
      this.config,
    );
    this.state.stored = result.stored;
    this.state.lastAccruedAt = now;
    this.write();
    return this.snapshot();
  }

  async collect(now: number): Promise<CollectOutcome> {
    await this.sync(now);
    const { taken, left } = collectFrom(this.state.stored, this.config);

    if (taken <= 0) {
      return { state: this.snapshot(), taken: 0, entry: null };
    }

    const entry: CollectLogEntry = {
      id: `${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      at: now,
      amount: taken,
      total: this.state.lifetime + taken,
      sinceMs: this.state.lastCollectedAt === null ? null : now - this.state.lastCollectedAt,
    };

    this.state.stored = left;
    this.state.lifetime = entry.total;
    this.state.lastCollectedAt = now;
    this.state.log.unshift(entry);
    if (this.state.log.length > this.config.logLimit) {
      this.state.log.length = this.config.logLimit;
    }
    this.write();

    return { state: this.snapshot(), taken, entry };
  }

  async log(limit = this.config.logLimit): Promise<CollectLogEntry[]> {
    return this.state.log.slice(0, limit).map((e) => ({ ...e }));
  }

  async reset(): Promise<PersistedState> {
    this.state = fresh(Date.now());
    this.write();
    return this.snapshot();
  }

  /** 데모/디버그 전용 — `?res=` 처리에 쓴다 */
  async debugSetStored(amount: number): Promise<PersistedState> {
    this.state.stored = Math.max(0, Math.min(this.config.capacity, amount));
    this.state.lastAccruedAt = Date.now();
    this.write();
    return this.snapshot();
  }

  private snapshot(): PersistedState {
    return { ...this.state, log: this.state.log.map((e) => ({ ...e })) };
  }

  private read(): PersistedState {
    const now = Date.now();
    const raw = this.storage?.getItem(STORAGE_KEY);
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
        log: Array.isArray(parsed.log) ? parsed.log.filter(isEntry) : [],
      };
    } catch {
      return fresh(now);
    }
  }

  private write(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 사파리 프라이빗 모드 등 — 저장 실패해도 세션은 계속 굴러가야 한다.
    }
  }
}

function fresh(now: number): PersistedState {
  return { lastAccruedAt: now, stored: 0, lifetime: 0, lastCollectedAt: null, log: [] };
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
