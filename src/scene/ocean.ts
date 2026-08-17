import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { flat, type FlatMaterial } from './flat-material.ts';

/** 하늘에 떠 있는 원형 바다의 크기 */
export const SEA_RADIUS = 7;
const SEGMENTS = 40;
const RINGS = 22;

/** 사인파 3개. GLSL 과 TS 가 이 배열 하나를 공유한다(아래에서 셰이더 코드를 생성). */
const WAVES = [
  { dx: 0.85, dz: 0.53, amp: 0.26, length: 6.4, speed: 1.0 },
  { dx: -0.45, dz: 0.89, amp: 0.15, length: 3.9, speed: 1.45 },
  { dx: 0.21, dz: -0.98, amp: 0.08, length: 2.3, speed: 2.05 },
] as const;

const TOTAL_AMP = WAVES.reduce((s, w) => s + w.amp, 0);

/** 가장자리에서 파도를 0으로 죽여야 원반 옆면과 이음새가 벌어지지 않는다 */
const DAMP_START = SEA_RADIUS * 0.72;
const DAMP_END = SEA_RADIUS * 0.995;

const f = (n: number): string => n.toFixed(6);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 파고 + 기울기. 셰이더의 waveGLSL 과 같은 식이어야 한다(배 흔들림 계산용). */
export function sampleWave(x: number, z: number, time: number): {
  height: number;
  slopeX: number;
  slopeZ: number;
} {
  let h = 0;
  let sx = 0;
  let sz = 0;
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.length;
    const phase = k * (x * w.dx + z * w.dz) + time * w.speed;
    h += w.amp * Math.sin(phase);
    sx += w.amp * k * w.dx * Math.cos(phase);
    sz += w.amp * k * w.dz * Math.cos(phase);
  }
  const r = Math.hypot(x, z);
  const damp = 1 - smoothstep(DAMP_START, DAMP_END, r);
  return { height: h * damp, slopeX: sx * damp, slopeZ: sz * damp };
}

const waveGLSL = WAVES.map((w) => {
  const k = (Math.PI * 2) / w.length;
  return /* glsl */ `
  {
    float ph = ${f(k)} * (p.x * ${f(w.dx)} + p.z * ${f(w.dz)}) + uTime * ${f(w.speed)};
    h  += ${f(w.amp)} * sin(ph);
    sx += ${f(w.amp * k * w.dx)} * cos(ph);
    sz += ${f(w.amp * k * w.dz)} * cos(ph);
  }`;
}).join('\n');

const VERT = /* glsl */ `
uniform float uTime;
varying float vHeight;
varying vec3 vNorm;

void main() {
  vec3 p = position;
  float h = 0.0;
  float sx = 0.0;
  float sz = 0.0;
${waveGLSL}

  float r = length(p.xz);
  float damp = 1.0 - smoothstep(${f(DAMP_START)}, ${f(DAMP_END)}, r);
  h *= damp;
  sx *= damp;
  sz *= damp;

  p.y += h;
  vHeight = h;
  vNorm = normalize(vec3(-sx, 1.0, -sz));

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

/**
 * 톤 스텝 3단계. 부드러운 스페큘러 없이 계단식 물결만 남긴다. (CLAUDE.md §3.2)
 */
const FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uCrest;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform float uLightPower;

varying float vHeight;
varying vec3 vNorm;

void main() {
  // 골(deep)이 화면을 넓게 먹으면 어두워 보인다 — 밝은 쪽에 면적을 더 준다
  float t = clamp(vHeight / ${f(TOTAL_AMP)} * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = t < 0.32 ? uDeep : (t < 0.72 ? uMid : uCrest);

  float lam = max(dot(normalize(vNorm), normalize(uLightDir)), 0.0);
  float shade = lam < 0.55 ? 0.9 : (lam < 0.86 ? 1.0 : 1.12);

  vec3 c = base * shade + uLightColor * base * 0.18 * uLightPower;

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/** 파도 계산이 가능하도록 링 형태로 촘촘히 나눈 원반 (CircleGeometry 는 내부 정점이 없어 못 씀) */
function buildDiscGrid(radius: number, rings: number, segments: number): BufferGeometry {
  const pos: number[] = [0, 0, 0];
  for (let i = 1; i <= rings; i++) {
    const r = radius * (i / rings) ** 0.82;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }

  const idx = (ring: number, seg: number): number => 1 + (ring - 1) * segments + (seg % segments);
  const indices: number[] = [];

  for (let j = 0; j < segments; j++) {
    indices.push(0, idx(1, j + 1), idx(1, j));
  }
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = idx(i, j);
      const b = idx(i, j + 1);
      const c = idx(i + 1, j + 1);
      const d = idx(i + 1, j);
      indices.push(a, c, b, a, d, c);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  return geo;
}

/**
 * 바다 덩어리의 아랫면 — "하늘에 떠 있는" 실루엣을 만드는 부분.
 *
 * 첫 두 링만 화면에 보이는 두께이고, 그 아래는 시선보다 빠르게 안쪽으로 말려 들어가
 * 실루엣 뒤에 숨는다. 덕분에 앞 가장자리 아래로 하늘이 드러난다.
 */
function buildUnderside(radius: number, segments: number): BufferGeometry {
  const profile: Array<[number, number]> = [
    [1.0, -0.62],
    [0.95, -1.05],
    [0.62, -2.1],
    [0.28, -2.85],
    [0.1, -3.15],
  ];

  const pos: number[] = [];
  for (const [rs, y] of profile) {
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * radius * rs, y, Math.sin(a) * radius * rs);
    }
  }
  const tipIndex = pos.length / 3;
  pos.push(0, -3.35, 0);

  const indices: number[] = [];
  const at = (row: number, seg: number): number => row * segments + (seg % segments);
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = at(i, j);
      const b = at(i, j + 1);
      const c = at(i + 1, j + 1);
      const d = at(i + 1, j);
      indices.push(a, b, c, a, c, d);
    }
  }
  const last = profile.length - 1;
  for (let j = 0; j < segments; j++) {
    indices.push(at(last, j), at(last, j + 1), tipIndex);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(indices);
  return geo;
}

export class Ocean {
  readonly group = new Group();
  private readonly surfaceMat: ShaderMaterial;
  private readonly rimMat: FlatMaterial;
  private readonly undersideMat: FlatMaterial;
  private readonly meshes: Mesh[] = [];

  constructor() {
    this.surfaceMat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new Color() },
        uMid: { value: new Color() },
        uCrest: { value: new Color() },
        uLightColor: { value: new Color() },
        uLightDir: { value: new Vector3(0, 1, 0) },
        uLightPower: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
    });

    const surface = new Mesh(buildDiscGrid(SEA_RADIUS, RINGS, SEGMENTS), this.surfaceMat);
    surface.name = 'ocean-surface';

    // 수면 가장자리 밝은 띠 — 떠 있는 바다의 실루엣을 또렷하게
    this.rimMat = flat('foam');
    this.rimMat.side = DoubleSide;
    const rim = new Mesh(
      new CylinderGeometry(SEA_RADIUS, SEA_RADIUS * 0.99, 0.62, SEGMENTS, 1, true),
      this.rimMat,
    );
    rim.position.y = -0.3;
    rim.name = 'ocean-rim';

    this.undersideMat = flat('abyss');
    const under = new Mesh(buildUnderside(SEA_RADIUS, SEGMENTS), this.undersideMat);
    under.name = 'ocean-underside';

    this.meshes.push(surface, rim, under);
    this.group.add(surface, rim, under);
    this.group.name = 'ocean';
  }

  update(state: SkyState, elapsed: number): void {
    const u = this.surfaceMat.uniforms;
    u.uTime!.value = elapsed;
    (u.uDeep!.value as Color).copy(state.oceanDeep);
    (u.uMid!.value as Color).copy(state.oceanMid);
    (u.uCrest!.value as Color).copy(state.oceanCrest);
    (u.uLightColor!.value as Color).copy(state.sunLight);
    (u.uLightDir!.value as Vector3).copy(state.sunDir);
    u.uLightPower!.value = state.sunIntensity;

    this.rimMat.setColor(state.oceanCrest);
    this.undersideMat.setColor(state.underside);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.surfaceMat.dispose();
    this.rimMat.dispose();
    this.undersideMat.dispose();
  }
}
