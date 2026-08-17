/**
 * 저장소 경계.
 *
 * UI·씬 코드는 절대 localStorage 를 직접 만지지 않는다. 전부 이 인터페이스를 거친다.
 * 나중에 `SupabaseGateway` 로 갈아끼우면 호출부는 한 줄도 안 바뀐다. (CLAUDE.md §5)
 * 지금 로컬이라도 전 메서드가 Promise 를 반환하는 이유다.
 */

export interface CollectLogEntry {
  id: string;
  /** 수거 시각 (epoch ms) */
  at: number;
  /** 이번에 수거한 양 */
  amount: number;
  /** 수거 직후 누적 총량 */
  total: number;
  /** 직전 수거로부터 흐른 시간(ms). 첫 수거면 null */
  sinceMs: number | null;
}

export interface PersistedState {
  /** 마지막 정산 시각 */
  lastAccruedAt: number;
  /** 정산 시점 보유량 */
  stored: number;
  /** 지금까지 수거한 누적 총량 */
  lifetime: number;
  /** 마지막 수거 시각. 아직 없으면 null */
  lastCollectedAt: number | null;
  log: CollectLogEntry[];
}

export interface CollectOutcome {
  state: PersistedState;
  /** 실제로 수거된 양. 0이면 수거 실패(자원 부족) */
  taken: number;
  entry: CollectLogEntry | null;
}

export interface MolehangGateway {
  /** 부팅 시 1회 — 오프라인 축적분이 이미 반영된 상태를 돌려준다 */
  load(): Promise<PersistedState>;
  /** 지금까지의 축적을 정산해 저장 */
  sync(now: number): Promise<PersistedState>;
  /** 수거 확정 */
  collect(now: number): Promise<CollectOutcome>;
  /** 수거 기록 (최신순) */
  log(limit?: number): Promise<CollectLogEntry[]>;
  /** 데모용 — 저장 초기화 */
  reset(): Promise<PersistedState>;
}
