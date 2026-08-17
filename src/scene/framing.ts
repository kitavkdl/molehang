import { SEA_RADIUS } from './ocean.ts';

/**
 * 카메라 프레이밍. 세로 화면이 기준이고 가로는 곁다리. (CLAUDE.md §4)
 *
 * 구도 목표
 *  - 배가 화면 가운데를 크게 차지한다
 *  - 원반 바다의 **앞쪽 가장자리**가 프레임 안에 들어와서 "떠 있다"가 읽힌다
 *  - 가장자리 너머로 하늘과 (바다보다 낮은 고도의) 구름이 보인다
 */
export interface Framing {
  fov: number;
  height: number;
  distance: number;
  targetY: number;
}

export const PORTRAIT: Framing = { fov: 38, height: 6.6, distance: 21, targetY: 1.35 };
export const LANDSCAPE: Framing = { fov: 32, height: 7.2, distance: 24, targetY: 1.5 };

/** 세로/가로 판단 기준 */
export const PORTRAIT_MAX_ASPECT = 0.8;

export function framingFor(aspect: number): Framing {
  return aspect < PORTRAIT_MAX_ASPECT ? PORTRAIT : LANDSCAPE;
}

/**
 * 화면 구도를 결정하는 두 개의 시선.
 *
 *   FAR  : 원반의 **먼** 가장자리를 스치는 시선 — 이 위쪽이 하늘 영역
 *   NEAR : 원반의 **앞** 가장자리를 스치는 시선 — 이 아래쪽이 바다 밑 하늘
 *
 * 두 선 사이가 바다가 차지하는 띠다. 구름을 이 띠 바깥에 놓아야
 * 원반에 가리지 않고 "바다가 공중에 떠 있다"가 읽힌다.
 */
const FAR_EDGE_SLOPE = PORTRAIT.height / (PORTRAIT.distance + SEA_RADIUS);
const NEAR_EDGE_SLOPE = PORTRAIT.height / (PORTRAIT.distance - SEA_RADIUS);

/** 먼 가장자리 위 하늘에 걸리는 최저 높이 */
export function skyBandFloorY(depth: number): number {
  return PORTRAIT.height - FAR_EDGE_SLOPE * depth;
}

/** 앞 가장자리 **아래**로 보이는 최고 높이 — 바다 밑을 흐르는 구름용 */
export function underSeaCeilY(depth: number): number {
  return PORTRAIT.height - NEAR_EDGE_SLOPE * depth;
}
