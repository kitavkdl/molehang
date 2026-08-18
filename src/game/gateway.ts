import type { ThemeId } from '../style/themes.ts';
import type { Inventory, PartKind, PartTier } from './parts.ts';

/**
 * 저장소 경계.
 *
 * UI·씬 코드는 절대 localStorage 를 직접 만지지 않는다. 전부 이 인터페이스를 거친다.
 * 나중에 `SupabaseGateway` 로 갈아끼우면 호출부는 한 줄도 안 바뀐다. (CLAUDE.md §5)
 */

export interface CollectLogEntry {
  id: string;
  /** 수거 시각 (epoch ms) */
  at: number;
  /** 이번에 수거한 고철 */
  amount: number;
  /** 수거 직후 누적 총량 */
  total: number;
  /** 직전 수거로부터 흐른 시간(ms). 첫 수거면 null */
  sinceMs: number | null;
}

export interface PersistedState {
  /** 마지막 정산 시각 */
  lastAccruedAt: number;
  /** 아직 수거하지 않고 쌓여 있는 고철 */
  pending: number;
  /** 뽑기에 쓸 수 있는 고철 잔고 */
  scrap: number;
  /** 지금까지 수거한 누적 총량 */
  lifetime: number;
  /** 마지막 수거 시각. 아직 없으면 null */
  lastCollectedAt: number | null;
  /** 배에 붙어 있는 부품 */
  parts: Inventory;
  /** 등급별 뽑기 횟수 — 가격 상승에 쓴다 */
  pulls: Record<PartTier, number>;
  /** 사용자가 끌어 놓은 부품 위치. 키는 "kind#순번", 없으면 격자 기본 자리 */
  placements: Record<string, [number, number, number]>;
  /** 한 번이라도 달성한 칭호 id */
  titles: string[];
  /** 지금 쓰는 바다 테마 */
  theme: ThemeId;
  /** 뽑아서 갖고 있는 테마 */
  themes: ThemeId[];
  /** 테마 뽑기 횟수 — 가격 상승 */
  themePulls: number;
  log: CollectLogEntry[];
}

export interface CollectOutcome {
  state: PersistedState;
  /** 실제로 수거된 양. 0이면 수거 실패 */
  taken: number;
  entry: CollectLogEntry | null;
}

export interface DrawOutcome {
  state: PersistedState;
  /** 뽑힌 부품. null 이면 고철 부족 */
  drawn: PartKind | null;
  /** 자리가 모자라 아직 장착되지 않았는지 */
  needsRoom: boolean;
}

export interface InstallOutcome {
  state: PersistedState;
  installed: PartKind;
  /** 자리를 비우려고 뽑아낸 부품 */
  removed: PartKind | null;
  /** 이번 장착으로 처음 달성한 칭호 id */
  newTitleId: string | null;
}

export interface MolehangGateway {
  /** 부팅 시 1회 — 오프라인 축적분이 이미 반영된 상태를 돌려준다 (보너스 미적용) */
  load(): Promise<PersistedState>;
  /** 지금까지의 축적을 정산해 저장. multiplier 는 선단 보너스 */
  sync(now: number, multiplier?: number): Promise<PersistedState>;
  /** 수거 확정 — 미수거분이 고철 잔고로 들어간다 */
  collect(now: number, multiplier?: number): Promise<CollectOutcome>;
  /** 뽑기 — 고철을 쓰고 부품 하나를 뽑는다. 장착은 별도(자리 결정이 필요할 수 있다) */
  draw(tier: PartTier, now: number, multiplier?: number): Promise<DrawOutcome>;
  /** 장착 확정. remove 를 주면 그 부품을 하나 빼고 자리를 만든다 */
  install(
    kind: PartKind,
    remove: PartKind | null,
    now: number,
    multiplier?: number,
  ): Promise<InstallOutcome>;
  /** 부품을 끌어 놓은 자리를 저장. null 이면 기본 자리로 되돌린다 */
  setPlacements(placements: Record<string, [number, number, number]>): Promise<PersistedState>;
  /** 테마 뽑기. drawn 이 null 이면 고철 부족이거나 이미 다 모았다 */
  drawTheme(): Promise<{ state: PersistedState; drawn: ThemeId | null; soldOut: boolean }>;
  /** 갖고 있는 테마로 바꾼다 */
  setTheme(id: ThemeId): Promise<PersistedState>;
  /** 친구가 보내온 몫 */
  receiveGift(now: number, scrap: number, multiplier?: number): Promise<PersistedState>;
  /** 수거 기록 (최신순) */
  log(limit?: number): Promise<CollectLogEntry[]>;
  /** 데모용 — 저장 초기화 */
  reset(): Promise<PersistedState>;
}

/**
 * 계정으로 옮길 만한 게스트 기록인지.
 *
 * 페이지를 열어 두기만 해도 미수거분(pending)은 저절로 쌓이므로 그건 기준이 못 된다.
 * **사람이 한 일**(수거·뽑기·장착)이 남아 있을 때만 계정으로 가져간다 —
 * 안 그러면 로그인할 때마다 빈 배가 한 척씩 늘어난다.
 */
export function hasProgress(state: PersistedState): boolean {
  if (state.lifetime > 0 || state.scrap > 0) return true;
  return Object.values(state.parts).some((count) => count > 0);
}
