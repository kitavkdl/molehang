import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3, type Box3 } from 'three';
import type { PartKind } from '../game/parts.ts';
import type { FlatMaterial } from './flat-material.ts';
import { partBounds } from './part-sockets.ts';

/**
 * 배치 모드 테두리 — **무엇을 만질 수 있는지** 보여 주는 표식.
 *
 * 선(LineSegments)을 쓰지 않는다. 굵기가 언제나 1px 이라 고해상도 모바일에서는
 * 실오라기처럼 보이고, 이 게임의 로우폴리 면 덩어리들과 재질이 안 맞는다.
 * 대신 **모서리 브래킷**(코너 8곳에서 뻗는 짧은 막대 24개)을 실제 면으로 만든다.
 * 상자를 통째로 두르면 부품이 격자 안에 갇힌 것처럼 보여서, 모서리만 집는다.
 *
 * 부품 종류마다 한 번만 만들어 재사용한다. 같은 종류가 12개여도 지오메트리는 하나다.
 */

/**
 * 막대 굵기 — 너무 얇으면 안 보이고, 두꺼우면 부품을 가린다.
 * 갑판에 작은 부품이 붙어 서면 테두리끼리 붙어 분홍 덩어리가 되므로 상한을 낮게 잡았다.
 */
const THICKNESS = [0.022, 0.04] as const;
/** 모서리에서 뻗는 길이 — 굵기보다 확실히 길어야 '덩어리'가 아니라 '꺾쇠'로 읽힌다 */
const ARM = [0.08, 0.3] as const;
/** 부품과 테두리 사이의 숨통 (굵기의 배수) */
const PAD = 2.4;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 정육면체 36개 정점의 부호. 와인딩은 신경 쓰지 않는다 — flat() 은 양면이다 */
const CUBE: ReadonlyArray<readonly [number, number, number]> = [
  [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, -1], [1, 1, 1], [1, -1, 1],
  [-1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1],
  [-1, 1, -1], [-1, 1, 1], [1, 1, 1], [-1, 1, -1], [1, 1, 1], [1, 1, -1],
  [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, -1], [1, -1, 1], [-1, -1, 1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, -1, 1], [1, 1, 1], [-1, 1, 1],
  [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, -1], [1, 1, -1], [1, -1, -1],
];

function pushBar(
  out: number[],
  center: [number, number, number],
  half: [number, number, number],
): void {
  for (const [sx, sy, sz] of CUBE) {
    out.push(center[0] + sx * half[0], center[1] + sy * half[1], center[2] + sz * half[2]);
  }
}

function buildCage(box: Box3): BufferGeometry {
  const size = box.getSize(new Vector3());
  const span: [number, number, number] = [size.x, size.y, size.z];
  const smallest = Math.min(span[0], span[1], span[2]);
  const t = clamp(smallest * 0.13, THICKNESS[0], THICKNESS[1]);
  const pad = t * PAD;

  const lo: [number, number, number] = [box.min.x - pad, box.min.y - pad, box.min.z - pad];
  const hi: [number, number, number] = [box.max.x + pad, box.max.y + pad, box.max.z + pad];

  const pos: number[] = [];
  for (let corner = 0; corner < 8; corner++) {
    // 코너 하나 = 세 축의 조합. 각 축으로 짧은 막대를 안쪽으로 뻗는다
    const at: [number, number, number] = [
      (corner & 1) === 0 ? lo[0] : hi[0],
      (corner & 2) === 0 ? lo[1] : hi[1],
      (corner & 4) === 0 ? lo[2] : hi[2],
    ];
    const inward: [number, number, number] = [
      (corner & 1) === 0 ? 1 : -1,
      (corner & 2) === 0 ? 1 : -1,
      (corner & 4) === 0 ? 1 : -1,
    ];

    for (let axis = 0; axis < 3; axis++) {
      const side = span[axis] + 2 * pad;
      // 막대가 변의 절반을 넘으면 꺾쇠가 아니라 상자가 된다
      const arm = Math.min(clamp(side * 0.36, ARM[0], ARM[1]), side / 2);
      const center: [number, number, number] = [...at];
      center[axis] += (inward[axis] * arm) / 2;
      const half: [number, number, number] = [t / 2, t / 2, t / 2];
      half[axis] = arm / 2;
      pushBar(pos, center, half);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return geo;
}

const cache = new Map<PartKind, BufferGeometry>();

function cageFor(kind: PartKind): BufferGeometry {
  let geo = cache.get(kind);
  if (geo === undefined) {
    geo = buildCage(partBounds(kind));
    cache.set(kind, geo);
  }
  return geo;
}

/**
 * 부품 그룹에 그대로 붙일 테두리. **부품의 자식**으로 들어가므로
 * 끌어 옮기면 테두리도 같이 따라간다 — 따로 좌표를 맞출 일이 없다.
 */
export function buildPartOutline(kind: PartKind, material: FlatMaterial): Mesh {
  const mesh = new Mesh(cageFor(kind), material);
  mesh.name = `outline-${kind}`;
  // 배치 모드에서만 켠다. 꺼져 있으면 레이캐스트도 통과한다
  mesh.visible = false;
  return mesh;
}

export function disposePartOutlines(): void {
  for (const geo of cache.values()) geo.dispose();
  cache.clear();
}
