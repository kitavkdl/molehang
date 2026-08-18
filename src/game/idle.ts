import type { Inventory, PartKind } from './parts.ts';

/**
 * 방치 컨텐츠 — **오래 비운 배에는 무언가 살기 시작한다.**
 *
 * 부팅 때 한 번, 마지막 정산 이후 흐른 시간(offlineMs)을 보고 배에 저절로
 * 부품이 붙는다. 뽑기와 마찬가지로 **선택권은 없다** — 자연은 허락을 구하지 않는다.
 * 그 강제성이 이 게임의 유머다. (CLAUDE.md §2)
 *
 * 규칙은 순수 계산이다. DOM·localStorage·three.js 를 import 하지 않는다.
 *
 *   - 12시간마다 이끼 +1 (한 번에 최대 2개). 이끼는 자리를 아예 안 먹는다(0칸) —
 *     방치가 자리 초과라는 교착을 만들 수 없다.
 *   - 24시간 넘게 비우면 갈매기가 둥지를 튼다 (한 번에 1개, 총 5개까지).
 *     둥지는 자리를 안 먹고 집세로 고철을 물어다 준다.
 *   - 72시간 넘게 비우면 유령 선원이 눌러앉는다. 유령은 배에 **한 명뿐**이다.
 */

export const IDLE_MOSS_MS = 12 * 3600_000;
export const IDLE_NEST_MS = 24 * 3600_000;
export const IDLE_GHOST_MS = 72 * 3600_000;

/** 한 번의 귀환에서 붙는 이끼 상한 */
const MOSS_PER_RETURN = 2;
/** 둥지 총량 상한 — 돛대가 갈매기 아파트가 되는 것까지만 허용한다 */
const NEST_MAX = 5;

export interface IdleGrowth {
  kind: PartKind;
  count: number;
}

/** 이번 귀환에서 저절로 붙을 부품들. */
export function idleGrowth(offlineMs: number, inv: Inventory): IdleGrowth[] {
  const out: IdleGrowth[] = [];
  if (!Number.isFinite(offlineMs) || offlineMs < IDLE_MOSS_MS) return out;

  // 이끼는 자리 0칸이라 빈자리를 따지지 않는다
  const mossCount = Math.min(MOSS_PER_RETURN, Math.floor(offlineMs / IDLE_MOSS_MS));
  if (mossCount > 0) out.push({ kind: 'moss', count: mossCount });

  if (offlineMs >= IDLE_NEST_MS && inv.gullNest < NEST_MAX) {
    out.push({ kind: 'gullNest', count: 1 });
  }

  if (offlineMs >= IDLE_GHOST_MS && inv.ghost === 0) {
    out.push({ kind: 'ghost', count: 1 });
  }

  return out;
}
