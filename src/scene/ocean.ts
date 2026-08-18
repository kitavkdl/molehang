import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { SkyState } from '../core/time-of-day.ts';

/**
 * 무한의 바다.
 *
 * 원반이 아니다 — 수평선까지 이어지고, 먼 거리는 하늘 색으로 흐려지며 사라진다.
 * 그래서 실제 지오메트리 끝(RADIUS)은 절대 눈에 보이지 않는다. (CLAUDE.md §4.1)
 *
 * 무드의 핵심은 두 가지다.
 *   1. 수평선 헤이즈 — 바다가 하늘로 자연스럽게 녹아든다
 *   2. 해/달 반사 길 — 수평선의 원반에서 카메라 쪽으로 길게 떨어지는 빛
 */

/** 지오메트리 반경. 헤이즈가 이보다 훨씬 앞에서 끝나므로 가장자리는 보이지 않는다. */
const RADIUS = 320;
const RINGS = 68;
const SEGMENTS = 96;

/** 헤이즈 시작/끝 거리 — 끝 지점부터는 완전히 하늘 색 */
const HAZE_NEAR = 34;
const HAZE_FAR = 165;

/** 사인파 3개. GLSL 과 TS 가 이 배열 하나를 공유한다(아래에서 셰이더 코드를 생성). */
const WAVES = [
  // 카메라가 수면에 가까워서 파장이 길면 근경이 거대한 색 얼룩이 된다.
  // 배 길이(6.3)보다 짧게 잡아야 물결이 물결로 읽힌다.
  { dx: 0.85, dz: 0.53, amp: 0.26, length: 5.6, speed: 1.0 },
  { dx: -0.45, dz: 0.89, amp: 0.14, length: 3.1, speed: 1.45 },
  { dx: 0.21, dz: -0.98, amp: 0.075, length: 1.7, speed: 2.1 },
] as const;

const TOTAL_AMP = WAVES.reduce((s, w) => s + w.amp, 0);

const f = (n: number): string => n.toFixed(6);

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
  return { height: h, slopeX: sx, slopeZ: sz };
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
varying float vDist;
varying vec2 vXZ;

void main() {
  vec3 p = position;
  float h = 0.0;
  float sx = 0.0;
  float sz = 0.0;
${waveGLSL}

  // 멀수록 파도를 눌러 준다 — 수평선 근처에서 지글거리는 노이즈 방지
  float d = length(p.xz);
  float calm = 1.0 - smoothstep(${f(HAZE_NEAR)}, ${f(HAZE_FAR)}, d);
  h *= calm;
  sx *= calm;
  sz *= calm;

  p.y += h;
  vHeight = h;
  vNorm = normalize(vec3(-sx, 1.0, -sz));
  vDist = d;
  vXZ = p.xz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

/**
 * 톤 스텝 3단계 + 반사 길 + 수평선 헤이즈.
 * 부드러운 스페큘러 없이 계단식 물결만 남긴다. (CLAUDE.md §3.2)
 */
const FRAG = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uCrest;
uniform vec3 uHaze;
uniform vec3 uGlow;
uniform vec3 uLightColor;
uniform vec3 uLightDir;
uniform vec2 uSunAxis;
uniform float uLightPower;
uniform float uGlint;
uniform float uTime;

varying float vHeight;
varying vec3 vNorm;
varying float vDist;
varying vec2 vXZ;

void main() {
  // 1. 파고에 따른 계단식 톤. 3단이면 근경이 넓적해 보여서 중간 계단을 하나 더 뒀다.
  float t = clamp(vHeight / ${f(TOTAL_AMP)} * 0.5 + 0.5, 0.0, 1.0);
  vec3 base =
      t < 0.30 ? uDeep
    : t < 0.56 ? mix(uDeep, uMid, 0.55)
    : t < 0.80 ? uMid
    : uCrest;

  float lam = max(dot(normalize(vNorm), normalize(uLightDir)), 0.0);
  float shade = lam < 0.55 ? 0.92 : (lam < 0.86 ? 1.0 : 1.1);
  vec3 c = base * shade + uLightColor * base * 0.16 * uLightPower;

  // 2. 해/달 반사 길 — 원반의 방위축에서 옆으로 얼마나 벗어났는지로 폭을 만든다.
  //    멀수록 넓어져 수평선에서 퍼지는 빛기둥이 된다.
  //    (반사 길은 관측자 발밑까지 이어지므로 반평면으로 자르지 않는다)
  float lateral = abs(dot(vXZ, vec2(-uSunAxis.y, uSunAxis.x)));
  float width = 1.2 + vDist * 0.2;
  float path = 1.0 - smoothstep(0.0, width, lateral);
  // 파도 마루에서만 끊겨 반짝이도록 — 계단식으로 잘라 플랫한 조각들로 남긴다
  float sparkle = step(0.46, t + path * 0.42);
  float glint = path * sparkle * uGlint;
  c = mix(c, uGlow, clamp(glint, 0.0, 1.0));

  // 3. 수평선 헤이즈 — 바다가 하늘로 녹아들어 지오메트리 끝이 안 보이게
  float haze = smoothstep(${f(HAZE_NEAR)}, ${f(HAZE_FAR)}, vDist);
  c = mix(c, uHaze, haze);

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/** 가까울수록 촘촘한 방사형 격자 — 무한 바다는 근거리 해상도가 전부다 */
function buildRadialGrid(radius: number, rings: number, segments: number): BufferGeometry {
  const pos: number[] = [0, 0, 0];
  for (let i = 1; i <= rings; i++) {
    // 지수 분포: 카메라 근처는 촘촘, 수평선 쪽은 성기게
    const r = radius * (i / rings) ** 3.1;
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

export class Ocean {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly mesh: Mesh;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new Color() },
        uMid: { value: new Color() },
        uCrest: { value: new Color() },
        uHaze: { value: new Color() },
        uGlow: { value: new Color() },
        uLightColor: { value: new Color() },
        uLightDir: { value: new Vector3(0, 1, 0) },
        uSunAxis: { value: new Vector2(0, -1) },
        uLightPower: { value: 1 },
        uGlint: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
    });

    this.mesh = new Mesh(buildRadialGrid(RADIUS, RINGS, SEGMENTS), this.material);
    this.mesh.name = 'ocean';
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.group.name = 'ocean';
  }

  update(state: SkyState, elapsed: number): void {
    const u = this.material.uniforms;
    u.uTime!.value = elapsed;
    (u.uDeep!.value as Color).copy(state.oceanDeep);
    (u.uMid!.value as Color).copy(state.oceanMid);
    (u.uCrest!.value as Color).copy(state.oceanCrest);
    // 수평선에서 하늘과 정확히 같은 색이 되어야 이음매가 안 보인다
    (u.uHaze!.value as Color).copy(state.skyBottom);
    (u.uGlow!.value as Color).copy(state.disc);
    (u.uLightColor!.value as Color).copy(state.sunLight);
    (u.uLightDir!.value as Vector3).copy(state.sunDir);
    u.uLightPower!.value = state.sunIntensity;
    u.uGlint!.value = state.glintIntensity;

    // 반사 길은 조명이 아니라 **원반**의 방위를 따라간다
    (u.uSunAxis!.value as Vector2).set(state.discDir.x, state.discDir.z).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
