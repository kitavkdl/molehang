import type { GameConfig } from './config.ts';

/**
 * 자원 축적의 **순수 계산**.
 *
 * DOM · localStorage · three.js 를 import 하지 않는다.
 * 나중에 Supabase Edge Function 으로 그대로 복사해 서버 권위 계산에 재사용한다. (CLAUDE.md §5)
 */

export interface AccrualInput {
  /** 마지막으로 축적을 정산한 시각 (epoch ms) */
  lastAccruedAt: number;
  /** 그 시점에 저장돼 있던 양 */
  stored: number;
  /** 지금 시각 (epoch ms) */
  now: number;
}

export interface AccrualResult {
  /** 상한이 적용된 현재 보유량 */
  stored: number;
  /** 이번 계산에서 실제로 늘어난 양 (상한에서 잘린 뒤) */
  gained: number;
  /** 상한 때문에 버려진 양 */
  wasted: number;
  /** 상한까지 남은 시간(ms). 이미 가득이면 0 */
  msUntilFull: number;
}

const MS_PER_MINUTE = 60_000;

export function accrue(input: AccrualInput, config: GameConfig): AccrualResult {
  const { capacity, ratePerMinute } = config;

  // 기기 시계가 뒤로 갔거나 저장값이 오염된 경우를 방어한다.
  const stored = clamp(safeNumber(input.stored, 0), 0, capacity);
  const elapsedMs = Math.max(0, safeNumber(input.now, 0) - safeNumber(input.lastAccruedAt, 0));

  const raw = (elapsedMs / MS_PER_MINUTE) * ratePerMinute;
  const next = Math.min(capacity, stored + raw);
  const gained = next - stored;

  const remaining = capacity - next;
  const msUntilFull = remaining <= 0 ? 0 : (remaining / ratePerMinute) * MS_PER_MINUTE;

  return {
    stored: next,
    gained,
    wasted: Math.max(0, raw - gained),
    msUntilFull,
  };
}

/** 수거: 보유량을 0으로 비우고 얼마를 가져갔는지 돌려준다. */
export function collectFrom(stored: number, config: GameConfig): { taken: number; left: number } {
  const amount = Math.floor(clamp(safeNumber(stored, 0), 0, config.capacity));
  if (amount < config.minCollect) return { taken: 0, left: stored };
  // 소수점 아래는 남겨 둔다 — 표시값(내림)과 실제 보유량이 어긋나지 않게.
  return { taken: amount, left: stored - amount };
}

export function fillRatio(stored: number, config: GameConfig): number {
  return clamp(stored / config.capacity, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function safeNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
