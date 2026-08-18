import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

/**
 * 코드로 생성하는 파라메트릭 선체와 부속 지오메트리.
 *
 * 외부 모델 파일도 텍스처도 쓰지 않는다 — 단면(rib)을 길이 방향으로 로프트해서 만든다.
 * 파츠(part-sockets.ts)도 여기 있는 조각들을 재사용한다.
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
  sections: 22,
  ribSteps: 5,
};

/** 정면이 아니라 살짝 비스듬히 — 뱃머리와 측면이 같이 보이게 */
export const BOAT_YAW = Math.PI * 0.19;

/** 길이방향 위치 t(0=선미, 1=선수) 에서의 폭 배율 / 갑판선 / 용골선 */
function station(t: number, spec: HullSpec): { w: number; yTop: number; yBottom: number } {
  const s = 0.18 + 0.82 * t;
  const bulge = Math.sin(Math.PI * s);
  return {
    w: bulge ** 0.9,
    // 뱃머리·선미가 살짝 들리는 시어 라인
    yTop: spec.freeboard + 0.5 * spec.freeboard * (1 - bulge),
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

export function toGeometry(pos: number[], indices: number[]): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  return geo;
}

export interface HullGeometries {
  hull: BufferGeometry;
  deck: BufferGeometry;
  rail: BufferGeometry;
  keel: BufferGeometry;
}

export function buildHull(spec: HullSpec = HULL): HullGeometries {
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
      railPos.push(edge.x * 0.9, edge.y + 0.13, edge.z);
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

  // --- 용골 띠 (배 밑 중앙선을 따라가는 짙은 줄) ---
  const keelPos: number[] = [];
  for (let i = 0; i < spec.sections; i++) {
    const rib = ribs[i]!;
    const keelPt = rib[spec.ribSteps]!;
    keelPos.push(-0.055, keelPt.y - 0.02, keelPt.z);
    keelPos.push(0.055, keelPt.y - 0.02, keelPt.z);
  }
  const keelIdx: number[] = [];
  for (let i = 0; i < spec.sections - 1; i++) {
    const a = i * 2;
    keelIdx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }

  return {
    hull: toGeometry(hullPos, hullIdx),
    deck: toGeometry(deckPos, deckIdx),
    rail: toGeometry(railPos, railIdx),
    keel: toGeometry(keelPos, keelIdx),
  };
}

/**
 * 삼각 돛 — 약간 배가 부른 곡면.
 * u0~u1 로 잘라내면 같은 곡면의 가로 띠가 나온다(줄무늬가 돛 밖으로 삐져나오지 않게).
 */
export function sailGeometry(
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

export function flagGeometry(size: number): BufferGeometry {
  return toGeometry([0, 0, 0, 0, size * 0.62, 0, 0, size * 0.31, -size * 1.25], [0, 1, 2]);
}

export function boxGeometry(w: number, h: number, d: number): BufferGeometry {
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
