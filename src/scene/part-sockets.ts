import { BufferGeometry, CylinderGeometry, Group, Mesh, OctahedronGeometry } from 'three';
import type { PartKind } from '../game/parts.ts';
import { PART_COLORS } from '../style/palette.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { HULL, boxGeometry, sailGeometry } from './hull.ts';

/**
 * 파츠 지오메트리 + **소켓 배치**.
 *
 * 핵심 규칙: n 번째 파츠는 항상 자리가 있어야 한다. 정해진 소켓이 다 차면
 * 위로 / 뒤로 / 옆으로 **쌓는다**. 엔진 12개를 받아도 실패하지 않고,
 * 대신 배가 우스꽝스러워진다 — 그게 의도다. (CLAUDE.md §2)
 *
 * 배치는 개수만으로 결정되는 순수 함수라 같은 인벤토리면 언제나 같은 배가 나온다.
 */

export interface Placement {
  x: number;
  y: number;
  z: number;
  rotY?: number;
  rotZ?: number;
  scale?: number;
}

const DECK_Y = HULL.freeboard;
const HALF_L = HULL.length / 2;
const HALF_B = HULL.beam / 2;

/** 좌우 번갈아 가며 바깥으로: 0, 1, -1, 2, -2 … */
function zigzag(i: number): number {
  return i % 2 === 0 ? i / 2 : -(i + 1) / 2;
}

/**
 * 파츠 종류별 n 번째 배치.
 * 층(layer)이 올라갈수록 위로 쌓이면서 조금씩 작아진다.
 */
export function placementFor(kind: PartKind, index: number): Placement {
  switch (kind) {
    // 선미에 가로 3개씩, 넘치면 위로 쌓인다 → 엔진 12개면 4층 탑
    case 'engine': {
      const perRow = 3;
      const layer = Math.floor(index / perRow);
      const slot = index % perRow;
      return {
        // 선미는 폭이 좁다 — 넓게 벌리면 선체 밖에 뜬 것처럼 보인다
        x: (slot - 1) * (HALF_B * 0.4),
        y: DECK_Y - 0.05 + layer * 0.44,
        z: -HALF_L + 0.5 - layer * 0.1,
        scale: 1 - Math.min(0.3, layer * 0.07),
      };
    }

    // 좌우 현측을 따라 한 줄, 다 차면 위층으로
    case 'window': {
      const perSide = 4;
      const side = index % 2 === 0 ? 1 : -1;
      const n = Math.floor(index / 2);
      const layer = Math.floor(n / perSide);
      const slot = n % perSide;
      return {
        x: side * (HALF_B * 0.86),
        y: DECK_Y - 0.3 + layer * 0.42,
        z: (slot - 1.5) * (HULL.length * 0.17),
        rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        scale: 1 - Math.min(0.25, layer * 0.08),
      };
    }

    // 갑판 양옆에서 바깥을 향해
    case 'cannon': {
      const perSide = 3;
      const side = index % 2 === 0 ? 1 : -1;
      const n = Math.floor(index / 2);
      const layer = Math.floor(n / perSide);
      const slot = n % perSide;
      return {
        x: side * (HALF_B * 0.66),
        y: DECK_Y + 0.16 + layer * 0.44,
        z: (slot - 1) * (HULL.length * 0.2) + 0.3,
        rotY: side > 0 ? 0.35 : -0.35,
        scale: 1 - Math.min(0.25, layer * 0.08),
      };
    }

    // 갑판 중앙선을 따라 앞뒤로, 넘치면 살짝 옆으로 벌어진다
    case 'chimney': {
      const perRow = 4;
      const row = Math.floor(index / perRow);
      const slot = index % perRow;
      return {
        x: zigzag(row) * (HALF_B * 0.5),
        y: DECK_Y + 0.34,
        z: -0.6 + slot * (HULL.length * 0.14),
        scale: 1 - Math.min(0.3, row * 0.1),
      };
    }

    // 기본 돛 **위로** 계속 쌓인다 → 돛 7개면 탑이 된다.
    // 기본 돛 꼭대기(갑판 + 3.3)보다 확실히 위에서 시작해야 실루엣이 겹쳐
    // 너덜너덜해 보이지 않는다. 각 돛은 자기 돛대 토막을 달고 올라간다.
    case 'sail': {
      return {
        x: 0,
        y: DECK_Y + 3.45 + index * 1.28,
        z: 0.45 - index * 0.1,
        scale: Math.max(0.45, 1 - index * 0.09),
      };
    }

    // 선체 표면에 눌러 붙는 이끼 — 결정적 의사난수로 흩뿌린다
    case 'moss': {
      const a = (index * 2.399963) % (Math.PI * 2);
      const side = index % 2 === 0 ? 1 : -1;
      return {
        // 선체에서 너무 떨어지면 나뭇잎을 꽂아 둔 것처럼 보인다 — 표면에 붙인다
        x: side * HALF_B * (0.4 + 0.3 * Math.abs(Math.sin(a * 1.7))),
        y: DECK_Y - 0.2 - 0.4 * Math.abs(Math.cos(a * 2.3)),
        z: (((index * 37) % 100) / 100 - 0.5) * HULL.length * 0.8,
        rotY: a,
        scale: 0.5 + ((index * 13) % 7) * 0.05,
      };
    }

    // 현연을 따라 매달린다
    case 'lantern': {
      const perSide = 4;
      const side = index % 2 === 0 ? 1 : -1;
      const n = Math.floor(index / 2);
      const layer = Math.floor(n / perSide);
      const slot = n % perSide;
      return {
        x: side * (HALF_B * 0.92),
        y: DECK_Y + 0.5 + layer * 0.46,
        z: (slot - 1.5) * (HULL.length * 0.16) - 0.2,
        scale: 1 - Math.min(0.2, layer * 0.07),
      };
    }

    // 갑판 앞쪽에 쌓이는 통
    case 'barrel': {
      const perRow = 3;
      const layer = Math.floor(index / perRow);
      const slot = index % perRow;
      return {
        x: (slot - 1) * 0.46,
        y: DECK_Y + 0.24 + layer * 0.46,
        z: HALF_L - 1.15 - layer * 0.2,
        scale: 1 - Math.min(0.25, layer * 0.08),
      };
    }
  }
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
  rotX?: number;
  rotZ?: number;
}

let cache: Record<PartKind, PartPiece[]> | null = null;

function buildPieces(): Record<PartKind, PartPiece[]> {
  return {
    engine: [
      { geo: boxGeometry(0.44, 0.42, 0.5), color: 'metal' },
      { geo: new CylinderGeometry(0.09, 0.11, 0.42, 6), color: 'metalTrim', y: 0.3, z: -0.14 },
      { geo: boxGeometry(0.5, 0.1, 0.12), color: 'glow', y: 0.0, z: -0.28 },
    ],
    window: [
      { geo: boxGeometry(0.1, 0.34, 0.34), color: 'frame' },
      { geo: boxGeometry(0.06, 0.22, 0.22), color: 'glass', x: 0.04 },
    ],
    cannon: [
      { geo: new CylinderGeometry(0.1, 0.13, 0.72, 7), color: 'metal', rotZ: Math.PI / 2, x: 0.2 },
      { geo: boxGeometry(0.26, 0.18, 0.3), color: 'wood', y: -0.14 },
    ],
    chimney: [
      { geo: new CylinderGeometry(0.15, 0.19, 0.72, 7), color: 'metal' },
      { geo: new CylinderGeometry(0.21, 0.21, 0.12, 7), color: 'metalTrim', y: 0.34 },
    ],
    sail: [
      { geo: sailGeometry(1.5, 1.35, 0.34), color: 'cloth' },
      { geo: sailGeometry(1.5, 1.32, 0.36, 0.42, 0.56), color: 'clothTrim' },
      { geo: new CylinderGeometry(0.045, 0.055, 1.6, 6), color: 'wood', y: 0.72 },
    ],
    moss: [
      { geo: new OctahedronGeometry(0.28, 0), color: 'moss' },
      { geo: new OctahedronGeometry(0.19, 0), color: 'moss', x: 0.22, y: 0.12, z: 0.16 },
      { geo: new OctahedronGeometry(0.15, 0), color: 'moss', x: -0.2, y: -0.06, z: -0.14 },
    ],
    lantern: [
      { geo: new CylinderGeometry(0.03, 0.03, 0.3, 5), color: 'metal', y: 0.24 },
      { geo: boxGeometry(0.2, 0.24, 0.2), color: 'glow' },
      { geo: boxGeometry(0.24, 0.06, 0.24), color: 'metalTrim', y: 0.15 },
    ],
    barrel: [
      { geo: new CylinderGeometry(0.19, 0.19, 0.42, 8), color: 'wood' },
      { geo: new CylinderGeometry(0.2, 0.2, 0.07, 8), color: 'metalTrim', y: 0.11 },
      { geo: new CylinderGeometry(0.2, 0.2, 0.07, 8), color: 'metalTrim', y: -0.11 },
    ],
  };
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
export function buildPart(kind: PartKind, index: number): Group {
  cache ??= buildPieces();
  const group = new Group();
  group.name = `part-${kind}-${index}`;

  for (const piece of cache[kind]) {
    const mesh = new Mesh(piece.geo, materialFor(piece.color));
    mesh.position.set(piece.x ?? 0, piece.y ?? 0, piece.z ?? 0);
    if (piece.rotX !== undefined) mesh.rotation.x = piece.rotX;
    if (piece.rotZ !== undefined) mesh.rotation.z = piece.rotZ;
    group.add(mesh);
  }

  const p = placementFor(kind, index);
  group.position.set(p.x, p.y, p.z);
  group.rotation.y = p.rotY ?? 0;
  group.rotation.z = p.rotZ ?? 0;
  group.scale.setScalar(p.scale ?? 1);
  return group;
}

export function disposePartCache(): void {
  if (cache !== null) {
    for (const pieces of Object.values(cache)) {
      for (const piece of pieces) piece.geo.dispose();
    }
    cache = null;
  }
  for (const m of materials.values()) m.dispose();
  materials.clear();
}
