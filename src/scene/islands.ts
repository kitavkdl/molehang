import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
} from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { col } from '../style/palette.ts';

/**
 * 수평선에 걸리는 먼 섬 실루엣.
 *
 * 무한의 바다는 그냥 두면 텅 빈 선 하나로 끝난다. 실루엣 몇 개가 들어가는 순간
 * 깊이와 무드가 생긴다.
 *
 * 통짜 단색으로 두면 종이 오려 붙인 것처럼 뜬다 — 밑동은 수평선 안개색,
 * 위로 갈수록 실루엣 색이 되도록 세로 그라데이션을 준다. 멀리 있는 산의 그 느낌.
 */

interface IslandSpec {
  /** 방위각(도) — 0이 화면 정면 */
  azimuth: number;
  distance: number;
  width: number;
  height: number;
  /** 봉우리 개수 */
  peaks: number;
  seed: number;
}

const ISLANDS: IslandSpec[] = [
  { azimuth: -26, distance: 235, width: 96, height: 20, peaks: 3, seed: 3 },
  { azimuth: -9, distance: 300, width: 120, height: 15, peaks: 4, seed: 11 },
  { azimuth: 7, distance: 205, width: 62, height: 13, peaks: 2, seed: 5 },
  { azimuth: 21, distance: 265, width: 104, height: 23, peaks: 3, seed: 17 },
  { azimuth: 39, distance: 190, width: 54, height: 11, peaks: 2, seed: 23 },
  { azimuth: -44, distance: 215, width: 70, height: 16, peaks: 2, seed: 29 },
];

const VERT = /* glsl */ `
attribute float aRise;
varying float vRise;
void main() {
  vRise = aRise;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uPeak;
uniform vec3 uHaze;
varying float vRise;
void main() {
  // 0 = 수면(안개에 잠김), 1 = 능선 꼭대기
  vec3 c = mix(uHaze, uPeak, smoothstep(0.0, 0.85, vRise));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/** 봉우리가 이어진 능선 하나를 삼각형 띠로 만든다 */
function buildRidge(spec: IslandSpec): BufferGeometry {
  const steps = spec.peaks * 6;
  const pos: number[] = [];
  const rise: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = (u - 0.5) * spec.width;
    // 양 끝은 바다에 잠기고 가운데가 솟는 실루엣
    const envelope = Math.sin(Math.PI * u) ** 0.7;
    const ridge =
      0.62 +
      0.38 * Math.sin(u * Math.PI * spec.peaks * 1.7 + spec.seed) * Math.cos(u * 3.1 + spec.seed);
    const y = Math.max(0, spec.height * envelope * ridge);
    pos.push(x, 0, 0, x, y, 0);
    rise.push(0, y / spec.height);
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRise', new Float32BufferAttribute(rise, 1));
  geo.setIndex(idx);
  return geo;
}

export class Islands {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly geometries: BufferGeometry[] = [];

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uPeak: { value: col('indigo') },
        uHaze: { value: col('ice') },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      // 능선 띠는 앞뒤 구분이 없다 — FrontSide 로 두면 통째로 컬링돼 사라진다
      side: DoubleSide,
    });

    for (const spec of ISLANDS) {
      const geo = buildRidge(spec);
      this.geometries.push(geo);
      const mesh = new Mesh(geo, this.material);
      const a = (spec.azimuth * Math.PI) / 180;
      mesh.position.set(Math.sin(a) * spec.distance, -0.4, -Math.cos(a) * spec.distance);
      mesh.rotation.y = a;
      this.group.add(mesh);
    }

    this.group.name = 'islands';
  }

  update(state: SkyState): void {
    (this.material.uniforms.uPeak!.value as Color).copy(state.island);
    // 바다 헤이즈와 같은 색이라야 수평선에서 이음매 없이 잠긴다
    (this.material.uniforms.uHaze!.value as Color).copy(state.skyBottom);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
