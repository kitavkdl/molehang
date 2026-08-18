import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { PartKind, PartZone } from '../game/parts.ts';
import { FITTINGS, HULL, hullBottomAt, hullDeckAt, hullHalfWidthAt } from './hull.ts';
import { ZONE_BOUNDS, clampToZone, partBounds } from './part-sockets.ts';

/**
 * 배치 물리 — **닿아 있어야 붙는다.**
 *
 * 물리 엔진을 붙이지 않았다. 런타임 의존성은 three 하나뿐이고(CLAUDE.md §6),
 * 애초에 이 게임에 필요한 건 강체 시뮬레이션이 아니라 규칙 하나다:
 *
 *   1. 부품은 **무언가에 닿아 있어야** 한다. 허공에 뜬 돛은 허용하지 않는다.
 *   2. 그 외에는 아무것도 따지지 않는다. **무게중심·균형·대칭은 검사하지 않는다.**
 *      대포 여섯 문이 전부 우현에 매달려 배가 뒤집힐 것처럼 보여도 그대로 설치된다 —
 *      그 기형이 이 게임의 유머이고, 균형까지 강요하면 배치의 자유가 사라진다.
 *
 * 그래서 여기 있는 것은 **접촉 판정과 낙하**뿐이다. 속도도 질량도 없다.
 *
 * 판정은 축 정렬 상자(AABB)끼리의 겹침으로 한다. 로우폴리 부품들은 대부분
 * 상자에 가깝고, 상자가 아닌 것(돛)은 여러 조각으로 쪼개 근사한다.
 * 좌표계는 전부 **배 로컬**이다 — 배는 파도에 흔들리므로 월드로 재면 매 프레임 답이 바뀐다.
 */

/**
 * 이 틈까지는 "닿았다"로 본다.
 *
 * 0 으로 두면 격자 기본 자리(placementFor)마저 떠 있는 것이 되어 버린다.
 * 배 길이가 6.3 이니 0.14 는 눈으로 붙어 보이는 한계쯤이다.
 */
export const CONTACT_GAP = 0.14;

/** 낙하 탐색 걸음 — 성기게 훑고, 걸린 구간만 잘게 되짚는다 */
const COARSE_STEP = 0.09;
const FINE_STEP = 0.015;

// ---------------------------------------------------------------------------
// 선체가 내주는 면 — 배에 처음부터 달려 있는 것들
// ---------------------------------------------------------------------------

const box = (
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): Box3 => new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));

/**
 * 선체를 길이 방향으로 썰어 상자들로 근사한다.
 * 통짜 상자 하나로 두면 뱃머리 바깥 허공이 전부 "갑판"이 되어 버린다.
 */
function hullSlices(slices = 9): Box3[] {
  const out: Box3[] = [];
  const half = HULL.length / 2;
  for (let i = 0; i < slices; i++) {
    const z0 = -half + (HULL.length * i) / slices;
    const z1 = -half + (HULL.length * (i + 1)) / slices;
    const zm = (z0 + z1) / 2;
    // 조각 안에서 가장 넓고 가장 높은 값을 쓴다 — 좁게 잡으면 갑판 끝이 허공이 된다
    const w = Math.max(hullHalfWidthAt(z0), hullHalfWidthAt(zm), hullHalfWidthAt(z1));
    const top = Math.max(hullDeckAt(z0), hullDeckAt(z1));
    const bottom = Math.min(hullBottomAt(z0), hullBottomAt(zm), hullBottomAt(z1));
    out.push(box(-w, bottom, z0, w, top, z1));
  }
  return out;
}

/** 돛대 — 위로 뻗은 기둥. 돛은 여기에 매달린다 */
function mastBox(): Box3 {
  const m = FITTINGS.mast;
  const centre = HULL.freeboard + m.height / 2 - m.drop;
  const r = m.bottom;
  return box(-r, centre - m.height / 2, m.z - r, r, centre + m.height / 2, m.z + r);
}

/**
 * 돛 — 위로 갈수록 좁아지는 삼각형이라 상자 하나로 감싸면
 * 꼭대기 뒤쪽 허공까지 "돛"이 된다. 높이로 썰어 각 층의 실제 현(chord)을 쓴다.
 */
function sailSlices(slices = 4): Box3[] {
  const s = FITTINGS.sail;
  const t = FITTINGS.stripe;
  const base = HULL.freeboard + s.rise;
  const out: Box3[] = [];
  for (let i = 0; i < slices; i++) {
    const u0 = i / slices;
    const u1 = (i + 1) / slices;
    // sailGeometry 와 같은 식: 현과 배부름 모두 위로 갈수록 줄어든다
    const chord = t.chord * (1 - u0 * 0.92);
    const bulge = t.bulge * (1 - u0 * 0.35);
    out.push(box(-bulge * 0.2, base + u0 * s.height, s.z - chord, bulge, base + u1 * s.height, s.z));
  }
  return out;
}

/** 고철이 담기는 갑판 상자 — 그 위에도 물건을 올릴 수 있다 */
function crateBox(): Box3 {
  const c = FITTINGS.crate;
  const t = FITTINGS.crateTrim;
  const top = HULL.freeboard + t.rise + t.height / 2;
  const bottom = HULL.freeboard + c.rise - c.height / 2;
  const hw = Math.max(c.width, t.width) / 2;
  const hd = Math.max(c.depth, t.depth) / 2;
  return box(-hw, bottom, c.z - hd, hw, top, c.z + hd);
}

/** 부품이 없어도 늘 짚을 수 있는 면들 */
export const HULL_SUPPORTS: readonly Box3[] = [
  ...hullSlices(),
  mastBox(),
  ...sailSlices(),
  crateBox(),
];

// ---------------------------------------------------------------------------
// 부품 상자
// ---------------------------------------------------------------------------

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const scaleVec = new Vector3();

/** 부품 하나가 배 로컬에서 차지하는 상자 */
export function partBox(
  kind: PartKind,
  position: Vector3,
  scale: number,
  rotY: number,
  out = new Box3(),
): Box3 {
  out.copy(partBounds(kind));
  quaternion.setFromEuler(euler.set(0, rotY, 0));
  matrix.compose(position, quaternion, scaleVec.setScalar(scale));
  return out.applyMatrix4(matrix);
}

// ---------------------------------------------------------------------------
// 접촉과 낙하
// ---------------------------------------------------------------------------

const probe = new Box3();
const dropped = new Box3();
const down = new Vector3();

/** 무엇 하나에라도 닿아 있는가 */
export function touches(target: Box3, supports: readonly Box3[]): boolean {
  probe.copy(target).expandByScalar(CONTACT_GAP);
  for (const support of supports) {
    if (probe.intersectsBox(support)) return true;
  }
  return false;
}

/**
 * 닿을 때까지 **아래로만** 내린다. 옆으로 미끄러뜨리지 않는다 —
 * 손가락이 가리킨 자리에서 부품이 제멋대로 도망가면 배치가 아니라 씨름이 된다.
 *
 * 구역 바닥까지 내려도 짚을 게 없으면 바닥에 둔다(현측 부품은 선체에 붙어 있으므로
 * 실제로는 여기까지 오지 않는다). 이동한 뒤의 원점 y 를 돌려준다.
 */
export function settledY(
  target: Box3,
  originY: number,
  zone: PartZone,
  supports: readonly Box3[],
): number {
  if (touches(target, supports)) return originY;

  const floor = ZONE_BOUNDS[zone].y[0];
  const span = originY - floor;
  if (span <= 0) return originY;

  for (let step = COARSE_STEP; step <= span + COARSE_STEP; step += COARSE_STEP) {
    const drop = Math.min(step, span);
    dropped.copy(target).translate(down.set(0, -drop, 0));
    if (touches(dropped, supports)) {
      // 성긴 걸음으로 지나쳤을 수 있다. 걸린 구간만 잘게 되짚어 처음 닿는 높이를 찾는다
      for (let back = drop - COARSE_STEP + FINE_STEP; back < drop; back += FINE_STEP) {
        dropped.copy(target).translate(down.set(0, -back, 0));
        if (touches(dropped, supports)) return originY - back;
      }
      return originY - drop;
    }
    if (drop >= span) break;
  }
  return floor;
}

// ---------------------------------------------------------------------------
// 배치 해결 — 드래그가 부르는 유일한 입구
// ---------------------------------------------------------------------------

/** 부품 하나를 상자로 만들 수 있을 만큼의 정보 */
export interface SupportPart {
  kind: PartKind;
  position: Vector3;
  scale: number;
  rotY: number;
}

export interface SupportSet {
  /** 짚을 수 있는 모든 면 = 선체 + 다른 부품들 */
  all: Box3[];
  /** 그 **위에 얹힐 수** 있는 것 = 다른 부품들만.
   *  선체·돛대는 여기 없다 — 현측 부품은 선체에 파묻혀 있는 게 정상이라
   *  선체를 밀어내기 대상으로 두면 부품이 배 밖으로 튕겨 나간다. */
  stack: Box3[];
}

/** 드래그를 시작할 때 한 번 만든다. 끄는 동안 다른 부품은 움직이지 않는다 */
export function collectSupports(others: Iterable<SupportPart>): SupportSet {
  const stack: Box3[] = [];
  for (const part of others) {
    stack.push(partBox(part.kind, part.position, part.scale, part.rotY));
  }
  return { all: [...HULL_SUPPORTS, ...stack], stack };
}

/** 겹쳐 있는 부품 위로 올려놓는다 (갑판·선미처럼 얹히는 구역에서만) */
function stackedY(target: Box3, originY: number, stackables: readonly Box3[]): number {
  let lift = 0;
  for (const other of stackables) {
    if (target.max.x <= other.min.x || target.min.x >= other.max.x) continue;
    if (target.max.z <= other.min.z || target.min.z >= other.max.z) continue;
    if (target.min.y >= other.max.y || target.max.y <= other.min.y) continue;
    lift = Math.max(lift, other.max.y - target.min.y);
  }
  return originY + lift;
}

const clampTo = (v: number, [lo, hi]: [number, number]): number => (v < lo ? lo : v > hi ? hi : v);

export interface Resolved {
  position: [number, number, number];
  /** 손가락이 가리킨 높이에서 실제로 옮겨졌는가 (UI 가 이유를 설명하는 데 쓴다) */
  moved: boolean;
}

/**
 * 끌어 놓으려는 자리를 **실제로 붙을 수 있는 자리**로 바꾼다.
 *
 * 순서가 전부다.
 *   1. 다른 부품 속에 박혀 있으면 그 위로 올린다 (얹히는 구역만)
 *   2. 그래도 허공이면 닿을 때까지 내린다
 *   3. 구역 밖으로 나가지 않게 다시 가둔다
 *
 * x·z 는 손대지 않는다. 옆으로 밀어내기 시작하면 부품이 손가락에서 도망간다.
 */
export function resolvePlacement(
  kind: PartKind,
  zone: PartZone,
  at: [number, number, number],
  scale: number,
  rotY: number,
  supports: SupportSet,
): Resolved {
  const bounds = ZONE_BOUNDS[zone];
  const cursor = new Vector3(at[0], at[1], at[2]);
  const target = new Box3();
  let y = at[1];

  if (bounds.restsOnTop) {
    // 한 번 올리면 그 위의 다른 부품과 다시 겹칠 수 있다. 몇 번만 되풀이한다
    for (let pass = 0; pass < 3; pass++) {
      partBox(kind, cursor.setY(y), scale, rotY, target);
      const lifted = clampTo(stackedY(target, y, supports.stack), bounds.y);
      if (Math.abs(lifted - y) < 1e-4) break;
      y = lifted;
    }
  }

  partBox(kind, cursor.setY(y), scale, rotY, target);
  y = clampTo(settledY(target, y, zone, supports.all), bounds.y);

  return { position: [at[0], y, at[2]], moved: Math.abs(y - at[1]) > 0.02 };
}

/** 자리를 제자리에서 고칠 수 있는 부품 — reseat 이 position 을 직접 쓴다 */
export interface SeatedPart extends SupportPart {
  key: string;
  zone: PartZone;
}

/**
 * 저장된 자리를 **다시 물리에 통과시킨다.**
 *
 * 저장소에는 이 규칙이 생기기 전에 찍힌 좌표가 남아 있다(현측 부품이 뱃머리 옆
 * 허공에 매달려 있던 시절의 것). 서버에서 오는 좌표도 마찬가지로 믿을 게 못 된다.
 * 그래서 불러올 때 한 번 구역에 다시 가두고 닿는 자리로 내려앉힌다.
 *
 * **격자 기본 자리(customKeys 에 없는 것)는 건드리지 않는다.** 그쪽은 구역 격자가
 * 위로 무한히 쌓아 올리는 자리라, 구역 상자에 가두면 탑이 뭉개진다. (CLAUDE.md §4.5)
 */
export function reseat(parts: SeatedPart[], customKeys: ReadonlySet<string>): void {
  if (customKeys.size === 0) return;
  for (const part of parts) {
    if (!customKeys.has(part.key)) continue;
    const clamped = clampToZone(part.zone, part.position.x, part.position.y, part.position.z);
    const supports = collectSupports(parts.filter((other) => other !== part));
    const { position } = resolvePlacement(
      part.kind,
      part.zone,
      clamped,
      part.scale,
      part.rotY,
      supports,
    );
    part.position.set(position[0], position[1], position[2]);
  }
}
