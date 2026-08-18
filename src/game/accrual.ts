import type { GameConfig } from './config.ts';

/**
 * 고철 축적의 **순수 계산**.
 *
 * DOM · localStorage · three.js 를 import 하지 않는다.
 * 나중에 Supabase Edge Function 으로 그대로 복사해 서버 권위 계산에 재사용한다. (CLAUDE.md §5)
 *
 * 생산량은 배에 달린 부품에서 나온다 — 그래서 축적 계산이 부품 구성에 직접 묶인다.
 */

export interface AccrualInput {
  /** 마지막으로 축적을 정산한 시각 (epoch ms) */
  lastAccruedAt: number;
  /** 그 시점에 쌓여 있던 미수거 고철 */
  pending: number;
  /** 지금 시각 (epoch ms) */
  now: number;
  /** 초당 생산량 (부품 구성에서 계산해 넣는다) */
  perSecond: number;
  /** 미수거 상한 */
  capacity: number;
  /**
   * 선단 보너스 배율. 기본 1.
   * **같이 접속해 있는 동안에만** 붙는 값이라 오프라인 구간에는 적용하지 않는다.
   */
  multiplier?: number;
}

export interface AccrualResult {
  /** 상한이 적용된 현재 미수거량 */
  pending: number;
  /** 이번 계산에서 실제로 늘어난 양 (상한에서 잘린 뒤) */
  gained: number;
  /** 상한 때문에 버려진 양 */
  wasted: number;
  /** 상한까지 남은 시간(ms). 이미 가득이면 0 */
  msUntilFull: number;
}

export function accrue(input: AccrualInput, _config: GameConfig): AccrualResult {
  const capacity = Math.max(0, safeNumber(input.capacity, 0));
  const multiplier = Math.max(1, safeNumber(input.multiplier, 1));
  const perSecond = Math.max(0, safeNumber(input.perSecond, 0)) * multiplier;

  // 기기 시계가 뒤로 갔거나 저장값이 오염된 경우를 방어한다.
  const pending = clamp(safeNumber(input.pending, 0), 0, capacity);
  const elapsedMs = Math.max(0, safeNumber(input.now, 0) - safeNumber(input.lastAccruedAt, 0));

  const raw = (elapsedMs / 1000) * perSecond;
  const next = Math.min(capacity, pending + raw);
  const gained = next - pending;

  const remaining = capacity - next;
  const msUntilFull = remaining <= 0 || perSecond <= 0 ? 0 : (remaining / perSecond) * 1000;

  return { pending: next, gained, wasted: Math.max(0, raw - gained), msUntilFull };
}

/** 수거: 미수거분을 잔고로 옮긴다 */
export function collectFrom(
  pending: number,
  config: GameConfig,
): { taken: number; left: number } {
  const amount = Math.floor(Math.max(0, safeNumber(pending, 0)));
  if (amount < config.minCollect) return { taken: 0, left: pending };
  // 소수점 아래는 남겨 둔다 — 표시값(내림)과 실제 보유량이 어긋나지 않게.
  return { taken: amount, left: pending - amount };
}

/**
 * 생산량에 비례하는 미수거 상한.
 * boost 는 부품 효과(물탱크·시계탑)에서 온다 — parts.ts 의 capacityBoost() 값.
 */
export function capacityFor(perSecond: number, config: GameConfig, boost = 1): number {
  return Math.max(
    config.minCapacity,
    Math.round(perSecond * config.capacitySeconds * Math.max(1, safeNumber(boost, 1))),
  );
}

export function fillRatio(pending: number, capacity: number): number {
  return capacity <= 0 ? 0 : clamp(pending / capacity, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function safeNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
