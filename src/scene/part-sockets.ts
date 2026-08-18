import { BufferGeometry, CylinderGeometry, Group, Mesh, OctahedronGeometry } from 'three';
import { PART_INFO, type PartKind, type PartZone } from '../game/parts.ts';
import { PART_COLORS } from '../style/palette.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { HULL, boxGeometry, sailGeometry } from './hull.ts';

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
    place: (col, row, layer) => ({
      x: (col === 0 ? -1 : 1) * (HALF_B * 0.88),
      y: DECK_Y - 0.28 + layer * 0.42,
      z: (row - 1.5) * (HULL.length * 0.17),
      rotY: col === 0 ? -Math.PI / 2 : Math.PI / 2,
      scale: 1 - Math.min(0.25, layer * 0.07),
    }),
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
    case 'hullExtension':
      return [
        { geo: keep(boxGeometry(0.6, 0.14, 1.4)), color: 'wood' },
        { geo: keep(boxGeometry(0.66, 0.06, 0.2)), color: 'metalTrim', y: 0.1, z: 0.5 },
        { geo: keep(boxGeometry(0.66, 0.06, 0.2)), color: 'metalTrim', y: 0.1, z: -0.5 },
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
  for (const m of materials.values()) m.dispose();
  materials.clear();
}
