import { Color, Vector3 } from 'three';
import {
  PHASE_COLORS,
  PHASE_DISC_DIR,
  PHASE_LIGHT,
  PHASE_SUN_DIR,
  col,
  type Phase,
} from '../style/palette.ts';
import type { Clock } from './clock.ts';

/**
 * 연출용 시각 소스. 자원 축적(Clock)과 분리되어 있다.
 * 자원은 서버 시각으로 가더라도 하늘 색은 유저 로컬 시각을 따르는 게 맞다. (CLAUDE.md §5)
 */
export interface TimeOfDaySource {
  /** 0.0 ~ 24.0 */
  hourOfDay(): number;
}

/** 유저 기기의 로컬 시각 */
export class LocalTimeOfDay implements TimeOfDaySource {
  constructor(private readonly clock: Clock) {}

  hourOfDay(): number {
    const d = new Date(this.clock.now());
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
}

/** 디버그/스크린샷용 고정 시각 (`?hour=`, `?phase=`) */
export class FixedTimeOfDay implements TimeOfDaySource {
  constructor(public hour: number) {}

  hourOfDay(): number {
    return ((this.hour % 24) + 24) % 24;
  }
}

/** 각 단계가 "가장 순수하게" 나타나는 시각 */
const ANCHORS: ReadonlyArray<{ hour: number; phase: Phase }> = [
  { hour: 5.5, phase: 'dawn' },
  { hour: 12.0, phase: 'day' },
  { hour: 18.5, phase: 'dusk' },
  { hour: 22.5, phase: 'night' },
];

export const PHASE_ANCHOR_HOUR: Record<Phase, number> = {
  dawn: 5.5,
  day: 12.0,
  dusk: 18.5,
  night: 22.5,
};

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** 현재 시각이 어떤 두 단계 사이에 있는지 + 보간 계수 */
export function resolvePhase(hour: number): { from: Phase; to: Phase; t: number } {
  const h = ((hour % 24) + 24) % 24;

  for (let i = 0; i < ANCHORS.length; i++) {
    const a = ANCHORS[i]!;
    const b = ANCHORS[(i + 1) % ANCHORS.length]!;
    const start = a.hour;
    let span = b.hour - a.hour;
    if (span <= 0) span += 24;

    let delta = h - start;
    if (delta < 0) delta += 24;

    if (delta < span) {
      return { from: a.phase, to: b.phase, t: smoothstep(delta / span) };
    }
  }
  // 도달 불가 — 방어적으로 낮 반환
  return { from: 'day', to: 'day', t: 0 };
}

/** 씬 전체가 매 프레임 소비하는 시간대 상태 */
export interface SkyState {
  hour: number;
  from: Phase;
  to: Phase;
  t: number;
  skyTop: Color;
  skyMid: Color;
  skyBottom: Color;
  oceanDeep: Color;
  oceanMid: Color;
  oceanCrest: Color;
  underside: Color;
  cloud: Color;
  sunLight: Color;
  hemiSky: Color;
  hemiGround: Color;
  disc: Color;
  sunIntensity: number;
  hemiIntensity: number;
  starIntensity: number;
  /** 조명 방향 */
  sunDir: Vector3;
  /** 하늘에 그려지는 해/달 원반 방향 (조명과 분리) */
  discDir: Vector3;
}

function blank(): SkyState {
  return {
    hour: 12,
    from: 'day',
    to: 'day',
    t: 0,
    skyTop: new Color(),
    skyMid: new Color(),
    skyBottom: new Color(),
    oceanDeep: new Color(),
    oceanMid: new Color(),
    oceanCrest: new Color(),
    underside: new Color(),
    cloud: new Color(),
    sunLight: new Color(),
    hemiSky: new Color(),
    hemiGround: new Color(),
    disc: new Color(),
    sunIntensity: 1,
    hemiIntensity: 1,
    starIntensity: 0,
    sunDir: new Vector3(0, 1, 0),
    discDir: new Vector3(0, 1, 0),
  };
}

const mixInto = (out: Color, from: Phase, to: Phase, t: number, pick: (p: Phase) => Color): Color =>
  out.copy(pick(from)).lerp(pick(to), t);

function lerpDir(
  out: Vector3,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): void {
  out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t).normalize();
}

/**
 * 시각 → 씬 색/라이트 전체를 보간해 채운다.
 * 여기서 나오는 모든 Color 는 palette.ts 의 12색 사이 보간이다. 새 색은 만들지 않는다.
 */
export function evaluateSky(hour: number, out: SkyState = blank()): SkyState {
  const { from, to, t } = resolvePhase(hour);
  out.hour = hour;
  out.from = from;
  out.to = to;
  out.t = t;

  mixInto(out.skyTop, from, to, t, (p) => col(PHASE_COLORS[p].sky.top));
  mixInto(out.skyMid, from, to, t, (p) => col(PHASE_COLORS[p].sky.mid));
  mixInto(out.skyBottom, from, to, t, (p) => col(PHASE_COLORS[p].sky.bottom));
  mixInto(out.oceanDeep, from, to, t, (p) => col(PHASE_COLORS[p].ocean.deep));
  mixInto(out.oceanMid, from, to, t, (p) => col(PHASE_COLORS[p].ocean.mid));
  mixInto(out.oceanCrest, from, to, t, (p) => col(PHASE_COLORS[p].ocean.crest));
  mixInto(out.underside, from, to, t, (p) => col(PHASE_COLORS[p].underside));
  mixInto(out.cloud, from, to, t, (p) => col(PHASE_COLORS[p].cloud));
  mixInto(out.sunLight, from, to, t, (p) => col(PHASE_COLORS[p].sunLight));
  mixInto(out.hemiSky, from, to, t, (p) => col(PHASE_COLORS[p].hemiSky));
  mixInto(out.hemiGround, from, to, t, (p) => col(PHASE_COLORS[p].hemiGround));
  mixInto(out.disc, from, to, t, (p) => col(PHASE_COLORS[p].disc));

  const la = PHASE_LIGHT[from];
  const lb = PHASE_LIGHT[to];
  out.sunIntensity = la.sun + (lb.sun - la.sun) * t;
  out.hemiIntensity = la.hemi + (lb.hemi - la.hemi) * t;
  out.starIntensity = la.star + (lb.star - la.star) * t;

  lerpDir(out.sunDir, PHASE_SUN_DIR[from], PHASE_SUN_DIR[to], t);
  lerpDir(out.discDir, PHASE_DISC_DIR[from], PHASE_DISC_DIR[to], t);

  return out;
}

export function createSkyState(): SkyState {
  return blank();
}

/** 라벨 (UI 표시용) */
export const PHASE_LABEL: Record<Phase, string> = {
  dawn: '새벽',
  day: '낮',
  dusk: '노을',
  night: '밤',
};

/** 지배적인 단계 하나 (라벨용) */
export function dominantPhase(state: SkyState): Phase {
  return state.t < 0.5 ? state.from : state.to;
}
