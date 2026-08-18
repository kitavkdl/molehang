import {
  Box3,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  OctahedronGeometry,
} from 'three';
import { PART_INFO, type PartKind, type PartZone } from '../game/parts.ts';
import { PART_COLORS } from '../style/palette.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { HULL, boxGeometry, flagGeometry, hullHalfWidthAt, sailGeometry } from './hull.ts';

/**
 * 파츠 지오메트리 + **구역 기반 배치**.
 *
 * 부품 종류마다 배치 규칙을 따로 쓰지 않는다. 부품은 자기 **구역**(갑판/현측/돛대/선미)만
 * 알고, 그 구역이 격자 자리를 순서대로 내준다. 자리가 다 차면 위층으로 쌓인다 —
 * 그래서 같은 종류를 12개 받아도 실패하지 않고 탑이 된다.
 *
 * 배치는 (구역, 순번)만 받는 순수 함수라 같은 인벤토리면 언제나 같은 배가 나온다.
 */

export interface Placement {
  x: number;
  y: number;
  z: number;
  rotY?: number;
  scale?: number;
}

const DECK_Y = HULL.freeboard;
const HALF_L = HULL.length / 2;
const HALF_B = HULL.beam / 2;

/**
 * 현측 부품이 붙는 x — **선체 껍데기를 따라간다.**
 *
 * 예전에는 어느 z 에서나 고정폭이었다. 배는 뱃머리·선미로 갈수록 좁아지니
 * 그 자리의 부품은 선체 옆 허공에 매달려 있었다. 배치 물리(part-support.ts)가
 * "닿아 있어야 한다"를 요구하는 순간 이건 그냥 버그다.
 * 1 보다 살짝 작게 곱해 껍데기에 살짝 파묻히게 한다.
 */
const SIDE_SINK = 0.92;

function sideOffsetAt(z: number): number {
  return hullHalfWidthAt(z) * SIDE_SINK;
}

/** 구역별 격자 규격 */
interface ZoneGrid {
  cols: number;
  rows: number;
  /** 한 층에 들어가는 개수 */
  perLayer: number;
  place: (col: number, row: number, layer: number) => Placement;
}

const ZONES: Record<PartZone, ZoneGrid> = {
  // 갑판 — 앞뒤 4 × 좌우 2, 넘치면 위로
  deck: {
    cols: 2,
    rows: 4,
    perLayer: 8,
    place: (col, row, layer) => ({
      x: (col - 0.5) * (HALF_B * 0.82),
      y: DECK_Y + 0.32 + layer * 0.62,
      z: -1.9 + row * (HULL.length * 0.15),
      scale: 1 - Math.min(0.3, layer * 0.08),
    }),
  },
  // 현측 — 좌우 양쪽에 4개씩
  side: {
    cols: 2,
    rows: 4,
    perLayer: 8,
    place: (col, row, layer) => {
      const z = (row - 1.5) * (HULL.length * 0.17);
      return {
        x: (col === 0 ? -1 : 1) * sideOffsetAt(z),
        y: DECK_Y - 0.28 + layer * 0.42,
        z,
        rotY: col === 0 ? -Math.PI / 2 : Math.PI / 2,
        scale: 1 - Math.min(0.25, layer * 0.07),
      };
    },
  },
  // 돛대 — 위로만 쌓인다
  mast: {
    cols: 1,
    rows: 1,
    perLayer: 1,
    place: (_col, _row, layer) => ({
      x: 0,
      y: DECK_Y + 3.45 + layer * 1.28,
      z: 0.45 - layer * 0.1,
      scale: Math.max(0.45, 1 - layer * 0.09),
    }),
  },
  // 선미 — 가로 3개씩, 넘치면 위로
  stern: {
    cols: 3,
    rows: 1,
    perLayer: 3,
    place: (col, _row, layer) => ({
      x: (col - 1) * (HALF_B * 0.4),
      y: DECK_Y - 0.05 + layer * 0.44,
      z: -HALF_L + 0.5 - layer * 0.1,
      scale: 1 - Math.min(0.3, layer * 0.07),
    }),
  },
};

/** 구역 안 n 번째 자리 */
export function placementFor(zone: PartZone, index: number): Placement {
  const grid = ZONES[zone];
  const layer = Math.floor(index / grid.perLayer);
  const slot = index % grid.perLayer;
  const row = Math.floor(slot / grid.cols);
  const col = slot % grid.cols;
  return grid.place(col, row, layer);
}

// ---------------------------------------------------------------------------
// 배치 커스텀 — 구역 **안에서만** 자유롭다
// ---------------------------------------------------------------------------

export interface ZoneBounds {
  x: [number, number];
  y: [number, number];
  z: [number, number];
  /** 좌우 어느 한쪽 면에 붙는 구역(현측)은 가까운 쪽으로 스냅한다 */
  snapSides?: boolean;
  /**
   * 부품이 **무언가 위에 얹히는** 구역인가.
   *
   * 갑판·선미의 물건은 바닥이나 다른 물건 위에 놓인다 — 겹치면 위로 올려 쌓는다.
   * 현측·돛대는 옆으로 매달리는 자리라, 선체나 돛대에 파묻히는 게 정상이다.
   * 여기서 위로 밀어내면 부품이 배에서 떨어져 나간다.
   */
  restsOnTop: boolean;
  /** 드래그 평면의 법선 (배 로컬 기준) */
  plane: 'horizontal' | 'sideways' | 'vertical';
}

/**
 * 구역별로 끌고 다닐 수 있는 범위.
 *
 * 자유롭게 두면 부품이 허공이나 선체 안쪽에 박힌다. "일정 부분 안에서 자유롭게" 라는
 * 규칙은 이 상자 안에서만 움직인다는 뜻이다.
 */
export const ZONE_BOUNDS: Record<PartZone, ZoneBounds> = {
  deck: {
    x: [-HALF_B * 0.62, HALF_B * 0.62],
    y: [DECK_Y + 0.28, DECK_Y + 2.6],
    z: [-HALF_L * 0.62, HALF_L * 0.6],
    restsOnTop: true,
    plane: 'horizontal',
  },
  side: {
    x: [-HALF_B * 0.9, HALF_B * 0.9],
    y: [DECK_Y - 0.72, DECK_Y + 1.2],
    z: [-HALF_L * 0.62, HALF_L * 0.58],
    snapSides: true,
    restsOnTop: false,
    plane: 'sideways',
  },
  mast: {
    x: [-0.12, 0.12],
    y: [DECK_Y + 1.6, DECK_Y + 9.5],
    z: [0.2, 0.7],
    restsOnTop: false,
    plane: 'vertical',
  },
  stern: {
    x: [-HALF_B * 0.55, HALF_B * 0.55],
    y: [DECK_Y - 0.15, DECK_Y + 2.4],
    z: [-HALF_L + 0.2, -HALF_L + 1.4],
    restsOnTop: true,
    plane: 'horizontal',
  },
};

const clamp = (v: number, [lo, hi]: [number, number]): number => (v < lo ? lo : v > hi ? hi : v);

/** 끌어 놓은 자리를 구역 안으로 밀어 넣는다 */
export function clampToZone(zone: PartZone, x: number, y: number, z: number): [number, number, number] {
  const b = ZONE_BOUNDS[zone];
  // z 를 먼저 확정해야 한다 — 현측은 그 z 에서의 선체 폭이 x 를 정한다
  const cz = clamp(z, b.z);
  const cx = b.snapSides === true ? Math.sign(x || 1) * sideOffsetAt(cz) : clamp(x, b.x);
  return [cx, clamp(y, b.y), cz];
}

// ---------------------------------------------------------------------------
// 지오메트리 — 종류당 한 번만 만들어 재사용한다
// ---------------------------------------------------------------------------

interface PartPiece {
  geo: BufferGeometry;
  color: keyof typeof PART_COLORS;
  x?: number;
  y?: number;
  z?: number;
  rotZ?: number;
}

let cache: Partial<Record<PartKind, PartPiece[]>> = {};
const geometries: BufferGeometry[] = [];

const keep = <T extends BufferGeometry>(geo: T): T => {
  geometries.push(geo);
  return geo;
};

function piecesFor(kind: PartKind): PartPiece[] {
  const cached = cache[kind];
  if (cached !== undefined) return cached;

  const built = build(kind);
  cache[kind] = built;
  return built;
}

/**
 * 부품 한 종류가 차지하는 로컬 상자. 배치 모드 테두리가 이걸 감싼다.
 * 조각마다 위치·회전이 따로 있으니 각 조각의 상자를 옮겨 놓고 합친다.
 */
const boundsCache = new Map<PartKind, Box3>();

export function partBounds(kind: PartKind): Box3 {
  const cached = boundsCache.get(kind);
  if (cached !== undefined) return cached;

  const box = new Box3();
  const matrix = new Matrix4();
  const piece = new Box3();
  for (const part of piecesFor(kind)) {
    part.geo.computeBoundingBox();
    const local = part.geo.boundingBox;
    if (local === null) continue;
    piece.copy(local);
    matrix
      .makeRotationZ(part.rotZ ?? 0)
      .setPosition(part.x ?? 0, part.y ?? 0, part.z ?? 0);
    box.union(piece.applyMatrix4(matrix));
  }

  boundsCache.set(kind, box);
  return box;
}

function build(kind: PartKind): PartPiece[] {
  switch (kind) {
    case 'moss':
      return [
        { geo: keep(new OctahedronGeometry(0.24, 0)), color: 'moss' },
        { geo: keep(new OctahedronGeometry(0.16, 0)), color: 'moss', x: 0.18, y: 0.1, z: 0.13 },
        { geo: keep(new OctahedronGeometry(0.13, 0)), color: 'moss', x: -0.16, y: -0.05, z: -0.11 },
      ];
    case 'window':
      return [
        { geo: keep(boxGeometry(0.1, 0.34, 0.34)), color: 'frame' },
        { geo: keep(boxGeometry(0.06, 0.22, 0.22)), color: 'glass', x: 0.04 },
      ];
    case 'lantern':
      return [
        { geo: keep(new CylinderGeometry(0.03, 0.03, 0.3, 5)), color: 'metal', y: 0.24 },
        { geo: keep(boxGeometry(0.2, 0.24, 0.2)), color: 'glow' },
        { geo: keep(boxGeometry(0.24, 0.06, 0.24)), color: 'metalTrim', y: 0.15 },
      ];
    case 'barrel':
      return [
        { geo: keep(new CylinderGeometry(0.19, 0.19, 0.42, 8)), color: 'wood' },
        { geo: keep(new CylinderGeometry(0.2, 0.2, 0.07, 8)), color: 'metalTrim', y: 0.11 },
        { geo: keep(new CylinderGeometry(0.2, 0.2, 0.07, 8)), color: 'metalTrim', y: -0.11 },
      ];
    case 'rope':
      return [
        { geo: keep(new CylinderGeometry(0.035, 0.035, 1.5, 5)), color: 'wood', rotZ: 0.5 },
        { geo: keep(new CylinderGeometry(0.035, 0.035, 1.5, 5)), color: 'wood', rotZ: -0.5 },
      ];
    case 'buoy':
      return [
        { geo: keep(new OctahedronGeometry(0.22, 0)), color: 'clothTrim' },
        { geo: keep(new CylinderGeometry(0.04, 0.04, 0.3, 5)), color: 'metal', y: 0.2 },
      ];
    case 'anchor':
      return [
        { geo: keep(new CylinderGeometry(0.035, 0.035, 0.46, 5)), color: 'metal' },
        { geo: keep(boxGeometry(0.3, 0.05, 0.05)), color: 'metalTrim', y: 0.16 },
        { geo: keep(new OctahedronGeometry(0.09, 0)), color: 'metal', x: 0.14, y: -0.2 },
        { geo: keep(new OctahedronGeometry(0.09, 0)), color: 'metal', x: -0.14, y: -0.2 },
      ];
    case 'duck':
      return [
        { geo: keep(new OctahedronGeometry(0.2, 0)), color: 'glow' },
        { geo: keep(new OctahedronGeometry(0.12, 0)), color: 'glow', y: 0.19, z: 0.12 },
        { geo: keep(boxGeometry(0.08, 0.05, 0.12)), color: 'clothTrim', y: 0.17, z: 0.26 },
      ];
    case 'net':
      return [
        { geo: keep(boxGeometry(0.05, 0.44, 0.44)), color: 'wood' },
        { geo: keep(new CylinderGeometry(0.02, 0.02, 0.6, 4)), color: 'cloth', x: 0.04, rotZ: 0.7 },
        { geo: keep(new CylinderGeometry(0.02, 0.02, 0.6, 4)), color: 'cloth', x: 0.04, rotZ: -0.7 },
      ];
    case 'weathervane':
      return [
        { geo: keep(new CylinderGeometry(0.022, 0.022, 0.55, 5)), color: 'metal' },
        { geo: keep(boxGeometry(0.34, 0.035, 0.035)), color: 'metalTrim', y: 0.24 },
        { geo: keep(flagGeometry(0.3)), color: 'flag', y: 0.28 },
      ];

    case 'engine':
      return [
        { geo: keep(boxGeometry(0.44, 0.42, 0.5)), color: 'metal' },
        { geo: keep(new CylinderGeometry(0.09, 0.11, 0.42, 6)), color: 'metalTrim', y: 0.3, z: -0.14 },
        { geo: keep(boxGeometry(0.5, 0.1, 0.12)), color: 'glow', z: -0.28 },
      ];
    case 'chimney':
      return [
        { geo: keep(new CylinderGeometry(0.15, 0.19, 0.72, 7)), color: 'metal' },
        { geo: keep(new CylinderGeometry(0.21, 0.21, 0.12, 7)), color: 'metalTrim', y: 0.34 },
      ];
    case 'sail':
      return [
        { geo: keep(sailGeometry(1.5, 1.35, 0.34)), color: 'cloth' },
        { geo: keep(sailGeometry(1.5, 1.32, 0.36, 0.42, 0.56)), color: 'clothTrim' },
        { geo: keep(new CylinderGeometry(0.045, 0.055, 1.6, 6)), color: 'wood', y: 0.72 },
      ];
    case 'cannon':
      return [
        { geo: keep(new CylinderGeometry(0.1, 0.13, 0.72, 7)), color: 'metal', rotZ: Math.PI / 2, x: 0.2 },
        { geo: keep(boxGeometry(0.26, 0.18, 0.3)), color: 'wood', y: -0.14 },
      ];
    case 'crane':
      return [
        { geo: keep(new CylinderGeometry(0.06, 0.08, 0.9, 6)), color: 'metal', y: 0.45 },
        { geo: keep(new CylinderGeometry(0.05, 0.05, 0.8, 5)), color: 'metalTrim', y: 0.86, z: 0.3, rotZ: 1.2 },
        { geo: keep(boxGeometry(0.3, 0.12, 0.3)), color: 'wood' },
      ];
    case 'tank':
      return [
        { geo: keep(new CylinderGeometry(0.26, 0.26, 0.55, 8)), color: 'metal' },
        { geo: keep(new CylinderGeometry(0.28, 0.28, 0.08, 8)), color: 'metalTrim', y: 0.26 },
      ];
    case 'wheelhouse':
      return [
        { geo: keep(boxGeometry(0.5, 0.42, 0.44)), color: 'frame' },
        { geo: keep(boxGeometry(0.4, 0.16, 0.06)), color: 'glass', y: 0.06, z: 0.22 },
        { geo: keep(boxGeometry(0.58, 0.08, 0.52)), color: 'clothTrim', y: 0.26 },
      ];
    case 'paddle':
      return [
        { geo: keep(new CylinderGeometry(0.36, 0.36, 0.1, 8)), color: 'wood', rotZ: Math.PI / 2 },
        { geo: keep(new CylinderGeometry(0.09, 0.09, 0.18, 6)), color: 'metalTrim', rotZ: Math.PI / 2 },
        { geo: keep(boxGeometry(0.06, 0.78, 0.14)), color: 'wood' },
        { geo: keep(boxGeometry(0.06, 0.78, 0.14)), color: 'wood', rotZ: Math.PI / 2 },
      ];
    case 'magnet':
      return [
        { geo: keep(new CylinderGeometry(0.05, 0.07, 0.8, 6)), color: 'metal', y: 0.4 },
        { geo: keep(new CylinderGeometry(0.045, 0.045, 0.7, 5)), color: 'metalTrim', y: 0.76, z: 0.26, rotZ: 1.25 },
        { geo: keep(boxGeometry(0.24, 0.26, 0.15)), color: 'clothTrim', y: 0.3, z: 0.52 },
        { geo: keep(boxGeometry(0.24, 0.07, 0.15)), color: 'glass', y: 0.13, z: 0.52 },
      ];

    case 'bigEngine':
      return [
        { geo: keep(boxGeometry(0.72, 0.62, 0.8)), color: 'metal' },
        { geo: keep(new CylinderGeometry(0.13, 0.16, 0.6, 6)), color: 'metalTrim', y: 0.45, z: -0.2 },
        { geo: keep(new CylinderGeometry(0.13, 0.16, 0.6, 6)), color: 'metalTrim', y: 0.45, z: 0.2 },
        { geo: keep(boxGeometry(0.8, 0.16, 0.16)), color: 'glow', z: -0.45 },
      ];
    case 'turbine':
      return [
        { geo: keep(new CylinderGeometry(0.34, 0.4, 0.7, 8)), color: 'metal' },
        { geo: keep(new CylinderGeometry(0.12, 0.12, 0.5, 6)), color: 'metalTrim', y: 0.5 },
        { geo: keep(new OctahedronGeometry(0.2, 0)), color: 'glow', y: 0.8 },
      ];
    case 'greatSail':
      return [
        { geo: keep(sailGeometry(2.3, 2.0, 0.5)), color: 'cloth' },
        { geo: keep(sailGeometry(2.3, 1.96, 0.53, 0.4, 0.56)), color: 'clothTrim' },
        { geo: keep(new CylinderGeometry(0.06, 0.075, 2.4, 6)), color: 'wood', y: 1.1 },
      ];
    case 'turret':
      return [
        { geo: keep(new CylinderGeometry(0.34, 0.38, 0.34, 8)), color: 'metal' },
        { geo: keep(boxGeometry(0.36, 0.3, 0.5)), color: 'metalTrim', y: 0.3 },
        { geo: keep(new CylinderGeometry(0.09, 0.11, 0.9, 6)), color: 'metal', y: 0.34, z: 0.5, rotZ: Math.PI / 2 },
      ];
    case 'beacon':
      return [
        { geo: keep(new CylinderGeometry(0.16, 0.26, 1.5, 7)), color: 'frame' },
        { geo: keep(new CylinderGeometry(0.3, 0.3, 0.1, 7)), color: 'metalTrim', y: 0.78 },
        { geo: keep(boxGeometry(0.34, 0.36, 0.34)), color: 'glow', y: 1.0 },
        { geo: keep(new CylinderGeometry(0.02, 0.22, 0.3, 6)), color: 'metal', y: 1.3 },
      ];
    case 'goldenDuck':
      return [
        { geo: keep(boxGeometry(0.44, 0.14, 0.44)), color: 'frame' },
        { geo: keep(new OctahedronGeometry(0.27, 0)), color: 'glow', y: 0.32 },
        { geo: keep(new OctahedronGeometry(0.15, 0)), color: 'glow', y: 0.56, z: 0.15 },
        { geo: keep(boxGeometry(0.1, 0.06, 0.15)), color: 'clothTrim', y: 0.53, z: 0.32 },
      ];
    case 'kraken':
      return [
        { geo: keep(new OctahedronGeometry(0.3, 0)), color: 'flag', y: 0.1 },
        { geo: keep(new CylinderGeometry(0.05, 0.03, 0.5, 5)), color: 'clothTrim', x: 0.2, y: -0.16, rotZ: 0.9 },
        { geo: keep(new CylinderGeometry(0.05, 0.03, 0.5, 5)), color: 'clothTrim', x: -0.2, y: -0.16, rotZ: -0.9 },
        { geo: keep(new CylinderGeometry(0.045, 0.03, 0.44, 5)), color: 'clothTrim', y: -0.24, rotZ: 0.15 },
      ];
    case 'clocktower':
      return [
        { geo: keep(new CylinderGeometry(0.15, 0.22, 1.2, 7)), color: 'frame' },
        { geo: keep(new CylinderGeometry(0.2, 0.2, 0.07, 8)), color: 'cloth', y: 0.62, rotZ: Math.PI / 2 },
        { geo: keep(boxGeometry(0.05, 0.16, 0.03)), color: 'metalTrim', x: 0.05, y: 0.66 },
        { geo: keep(new OctahedronGeometry(0.12, 0)), color: 'metalTrim', y: 0.82 },
      ];
    case 'hullExtension':
      return [
        { geo: keep(boxGeometry(0.6, 0.14, 1.4)), color: 'wood' },
        { geo: keep(boxGeometry(0.66, 0.06, 0.2)), color: 'metalTrim', y: 0.1, z: 0.5 },
        { geo: keep(boxGeometry(0.66, 0.06, 0.2)), color: 'metalTrim', y: 0.1, z: -0.5 },
      ];
    case 'barnacle':
      return [
        { geo: keep(new OctahedronGeometry(0.11, 0)), color: 'metal' },
        { geo: keep(new OctahedronGeometry(0.075, 0)), color: 'metalTrim', x: 0.12, y: 0.05, z: 0.08 },
        { geo: keep(new OctahedronGeometry(0.06, 0)), color: 'metal', x: -0.1, y: -0.03, z: -0.06 },
      ];
    case 'gullNest':
      return [
        { geo: keep(new CylinderGeometry(0.17, 0.13, 0.11, 7)), color: 'wood' },
        { geo: keep(new OctahedronGeometry(0.055, 0)), color: 'cloth', x: 0.05, y: 0.07 },
        { geo: keep(new OctahedronGeometry(0.05, 0)), color: 'cloth', x: -0.06, y: 0.07, z: 0.04 },
        { geo: keep(new OctahedronGeometry(0.09, 0)), color: 'cloth', y: 0.13, z: -0.05 },
      ];
    case 'ghost':
      return [
        { geo: keep(new OctahedronGeometry(0.22, 0)), color: 'glass', y: 0.14 },
        { geo: keep(new OctahedronGeometry(0.13, 0)), color: 'glass', y: 0.4 },
        { geo: keep(new OctahedronGeometry(0.07, 0)), color: 'glass', x: 0.2, y: 0.2 },
        { geo: keep(new OctahedronGeometry(0.07, 0)), color: 'glass', x: -0.2, y: 0.2 },
      ];
  }
}

/** 종류별 머티리얼도 공유 — 파츠가 60개여도 머티리얼은 색 수만큼만 생긴다 */
const materials = new Map<string, FlatMaterial>();
function materialFor(role: keyof typeof PART_COLORS): FlatMaterial {
  let m = materials.get(role);
  if (m === undefined) {
    m = flat(PART_COLORS[role]);
    materials.set(role, m);
  }
  return m;
}

/** 부품 하나를 식별하는 키 — 배치 저장의 단위 */
export function partKey(kind: PartKind, indexOfKind: number): string {
  return `${kind}#${indexOfKind}`;
}

/** 키에서 부품 종류만. 없는 종류면 null — 저장소에 옛 키가 남아 있을 수 있다 */
export function kindFromKey(key: string): PartKind | null {
  const kind = key.split('#')[0] as PartKind;
  return PART_INFO[kind] === undefined ? null : kind;
}

/** 파츠 하나를 그룹으로 만들어 준다 */
export function buildPart(kind: PartKind, zoneIndex: number): Group {
  const group = new Group();
  group.name = `part-${kind}-${zoneIndex}`;

  for (const piece of piecesFor(kind)) {
    const mesh = new Mesh(piece.geo, materialFor(piece.color));
    mesh.position.set(piece.x ?? 0, piece.y ?? 0, piece.z ?? 0);
    if (piece.rotZ !== undefined) mesh.rotation.z = piece.rotZ;
    group.add(mesh);
  }

  const p = placementFor(PART_INFO[kind].zone, zoneIndex);
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.rotY ?? 0;
  group.scale.setScalar(p.scale ?? 1);
  return group;
}

export function disposePartCache(): void {
  for (const geo of geometries) geo.dispose();
  geometries.length = 0;
  cache = {};
  boundsCache.clear();
  for (const m of materials.values()) m.dispose();
  materials.clear();
}
