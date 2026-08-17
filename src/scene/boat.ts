import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  Vector3,
} from 'three';
import { BOAT_COLORS, type PaletteKey } from '../style/palette.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { sampleWave } from './ocean.ts';

/**
 * 코드로 생성하는 파라메트릭 선체.
 *
 * 외부 모델 파일도 텍스처도 쓰지 않는다 — 단면(rib)을 길이 방향으로 로프트해서 만든다.
 * 뗏목~소형 보트 수준의 작은 배 한 척. (CLAUDE.md §2)
 */
export interface HullSpec {
  length: number;
  beam: number;
  depth: number;
  freeboard: number;
  sections: number;
  ribSteps: number;
}

export const HULL: HullSpec = {
  length: 6.3,
  beam: 2.4,
  depth: 0.92,
  freeboard: 0.44,
  sections: 20,
  ribSteps: 5,
};

/** 정면이 아니라 살짝 비스듬히 — 뱃머리와 측면이 같이 보이게 */
export const BOAT_YAW = Math.PI * 0.2;

/** 길이방향 위치 t(0=선미, 1=선수) 에서의 폭 배율 / 갑판선 / 용골선 */
function station(t: number, spec: HullSpec): { w: number; yTop: number; yBottom: number } {
  const s = 0.18 + 0.82 * t;
  const bulge = Math.sin(Math.PI * s);
  return {
    w: bulge ** 0.9,
    // 뱃머리·선미가 살짝 들리는 시어 라인
    yTop: spec.freeboard + 0.42 * spec.freeboard * (1 - bulge),
    yBottom: -spec.depth * (0.35 + 0.65 * bulge),
  };
}

function ribPoints(t: number, spec: HullSpec): Vector3[] {
  const { w, yTop, yBottom } = station(t, spec);
  const halfW = (spec.beam / 2) * w;
  const z = (t - 0.5) * spec.length;
  const m = spec.ribSteps;
  const pts: Vector3[] = [];

  for (let p = 0; p <= 2 * m; p++) {
    const side = p < m ? -1 : 1;
    const a = p < m ? (m - p) / m : (p - m) / m;
    const ang = (a * Math.PI) / 2;
    pts.push(
      new Vector3(side * halfW * Math.sin(ang), yBottom + (yTop - yBottom) * (1 - Math.cos(ang)), z),
    );
  }
  return pts;
}

function toGeometry(pos: number[], indices: number[]): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildHull(spec: HullSpec): { hull: BufferGeometry; deck: BufferGeometry; rail: BufferGeometry } {
  const ribs: Vector3[][] = [];
  for (let i = 0; i < spec.sections; i++) {
    ribs.push(ribPoints(i / (spec.sections - 1), spec));
  }
  const perRib = ribs[0]!.length;

  // --- 외판 (로프트) ---
  const hullPos: number[] = [];
  for (const rib of ribs) for (const p of rib) hullPos.push(p.x, p.y, p.z);

  const hullIdx: number[] = [];
  const hi = (sec: number, p: number): number => sec * perRib + p;
  for (let i = 0; i < spec.sections - 1; i++) {
    for (let p = 0; p < perRib - 1; p++) {
      hullIdx.push(hi(i, p), hi(i, p + 1), hi(i + 1, p + 1));
      hullIdx.push(hi(i, p), hi(i + 1, p + 1), hi(i + 1, p));
    }
  }

  // 선미 트랜섬 — 첫 단면을 중심점 팬으로 막는다
  const stern = ribs[0]!;
  const centroid = stern
    .reduce((acc, p) => acc.add(p), new Vector3())
    .multiplyScalar(1 / stern.length);
  const centroidIdx = hullPos.length / 3;
  hullPos.push(centroid.x, centroid.y, centroid.z);
  for (let p = 0; p < perRib; p++) {
    hullIdx.push(centroidIdx, hi(0, (p + 1) % perRib), hi(0, p));
  }

  // --- 갑판 (양 현측 사이를 덮는 리본) ---
  const deckPos: number[] = [];
  for (let i = 0; i < spec.sections; i++) {
    const rib = ribs[i]!;
    const port = rib[0]!;
    const star = rib[perRib - 1]!;
    deckPos.push(port.x * 0.985, port.y, port.z, star.x * 0.985, star.y, star.z);
  }
  const deckIdx: number[] = [];
  for (let i = 0; i < spec.sections - 1; i++) {
    const a = i * 2;
    deckIdx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }

  // --- 현연 (갑판 가장자리 띠) ---
  const railPos: number[] = [];
  for (const sideSign of [-1, 1]) {
    for (let i = 0; i < spec.sections; i++) {
      const rib = ribs[i]!;
      const edge = sideSign < 0 ? rib[0]! : rib[perRib - 1]!;
      railPos.push(edge.x, edge.y, edge.z);
      railPos.push(edge.x * 0.9, edge.y + 0.12, edge.z);
    }
  }
  const railIdx: number[] = [];
  for (let side = 0; side < 2; side++) {
    const base = side * spec.sections * 2;
    for (let i = 0; i < spec.sections - 1; i++) {
      const a = base + i * 2;
      railIdx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  return {
    hull: toGeometry(hullPos, hullIdx),
    deck: toGeometry(deckPos, deckIdx),
    rail: toGeometry(railPos, railIdx),
  };
}

/**
 * 삼각 돛 — 약간 배가 부른 곡면.
 * u0~u1 로 잘라내면 같은 곡면의 가로 띠가 나온다(돛 줄무늬가 돛 밖으로 삐져나오지 않게).
 */
function buildSail(
  height: number,
  chord: number,
  bulge: number,
  u0 = 0,
  u1 = 1,
): BufferGeometry {
  const nu = 6;
  const nv = 5;
  const pos: number[] = [];
  for (let iu = 0; iu <= nu; iu++) {
    const u = u0 + ((u1 - u0) * iu) / nu;
    const c = chord * (1 - u * 0.92);
    for (let iv = 0; iv <= nv; iv++) {
      const v = iv / nv;
      pos.push(bulge * Math.sin(Math.PI * v) * (1 - u * 0.35), u * height, -c * v);
    }
  }
  const idx: number[] = [];
  const at = (iu: number, iv: number): number => iu * (nv + 1) + iv;
  for (let iu = 0; iu < nu; iu++) {
    for (let iv = 0; iv < nv; iv++) {
      idx.push(at(iu, iv), at(iu, iv + 1), at(iu + 1, iv + 1));
      idx.push(at(iu, iv), at(iu + 1, iv + 1), at(iu + 1, iv));
    }
  }
  return toGeometry(pos, idx);
}

function buildFlag(size: number): BufferGeometry {
  const pos = [0, 0, 0, 0, size * 0.62, 0, 0, size * 0.31, -size * 1.25];
  return toGeometry(pos, [0, 1, 2]);
}

function box(w: number, h: number, d: number): BufferGeometry {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const pos = [
    -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
    -hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz,
  ];
  const idx = [
    0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 3, 2, 6, 3, 6, 7,
    4, 5, 1, 4, 1, 0, 1, 5, 6, 1, 6, 2, 4, 0, 3, 4, 3, 7,
  ];
  return toGeometry(pos, idx);
}

export class Boat {
  readonly group = new Group();
  /** 배 전체를 감싸는 안쪽 그룹 — 바운스 스케일은 여기에만 준다 */
  private readonly body = new Group();
  private readonly crate: Mesh;
  private readonly materials: FlatMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];

  private bounceT = Infinity;
  private readonly crateWorld = new Vector3();

  constructor(spec: HullSpec = HULL) {
    const { hull, deck, rail } = buildHull(spec);

    const add = (geo: BufferGeometry, key: PaletteKey, name: string): Mesh => {
      // 전부 단색 flat shading. 텍스처·PBR 금지. (CLAUDE.md §3.2)
      const material = flat(key);
      const mesh = new Mesh(geo, material);
      mesh.name = name;
      this.materials.push(material);
      this.geometries.push(geo);
      this.body.add(mesh);
      return mesh;
    };

    add(hull, BOAT_COLORS.hull, 'hull');
    add(deck, BOAT_COLORS.deck, 'deck');
    add(rail, BOAT_COLORS.rail, 'rail');

    const mastHeight = 3.7;
    const mast = add(
      new CylinderGeometry(0.055, 0.085, mastHeight, 6, 1),
      BOAT_COLORS.mast,
      'mast',
    );
    mast.position.set(0, spec.freeboard + mastHeight / 2 - 0.14, 0.5);

    const sailY = spec.freeboard + 0.3;
    const sail = add(buildSail(3.0, 2.75, 0.56), BOAT_COLORS.sail, 'sail');
    sail.position.set(0, sailY, 0.45);

    // 같은 곡면의 u 0.46~0.60 구간을 살짝 바깥쪽(1.05배)으로 띄운 가로 띠
    const stripe = add(
      buildSail(3.0, 2.69, 0.588, 0.46, 0.6),
      BOAT_COLORS.sailStripe,
      'sail-stripe',
    );
    stripe.position.set(0, sailY, 0.45);

    const flag = add(buildFlag(0.62), BOAT_COLORS.flag, 'flag');
    flag.position.set(0, spec.freeboard + mastHeight - 0.74, 0.5);

    // 수거한 자원이 빨려 들어가는 나무 상자
    this.crate = add(box(0.86, 0.64, 0.8), BOAT_COLORS.crate, 'crate');
    this.crate.position.set(0, spec.freeboard + 0.32, -1.6);

    const trim = add(box(0.93, 0.12, 0.87), BOAT_COLORS.crateTrim, 'crate-trim');
    trim.position.set(0, spec.freeboard + 0.64, -1.6);

    this.body.rotation.y = BOAT_YAW;
    this.group.add(this.body);
    this.group.name = 'boat';
  }

  /** 파도 위에서 흔들린다 — 바다 셰이더와 같은 파형 함수를 공유 */
  update(elapsed: number, dt: number): void {
    const { height, slopeX, slopeZ } = sampleWave(0, 0, elapsed);

    let bounceScale = 1;
    let bounceLift = 0;
    if (this.bounceT < 1.2) {
      this.bounceT += dt;
      const t = this.bounceT;
      const decay = Math.exp(-5.2 * t);
      bounceScale = 1 + 0.11 * decay * Math.sin(t * 17);
      bounceLift = 0.14 * decay * Math.sin(t * 13);
    }

    this.group.position.y = height + bounceLift;
    this.group.rotation.z = -slopeX * 0.55;
    this.group.rotation.x = slopeZ * 0.55;
    this.body.scale.setScalar(bounceScale);

    this.crate.getWorldPosition(this.crateWorld);
  }

  /** 수거 시 가벼운 스케일 바운스 */
  bounce(): void {
    this.bounceT = 0;
  }

  /** 파티클이 빨려 들어갈 목표점 */
  get collectTarget(): Vector3 {
    return this.crateWorld;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
