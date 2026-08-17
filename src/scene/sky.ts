import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Color, Vector3 } from 'three';
import type { SkyState } from '../core/time-of-day.ts';

/**
 * 그라데이션 스카이돔.
 *
 * 색은 전부 uniform 으로 들어온다 — 셰이더 안에 리터럴 색이 없다. (CLAUDE.md §3.1)
 * 낮/노을/밤/새벽 4단계는 evaluateSky() 가 보간해서 여기로 밀어 넣는다.
 */
const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBottom;
uniform vec3 uDisc;
uniform vec3 uDiscDir;
uniform float uStar;
uniform float uTime;

varying vec3 vDir;

float hash13(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);

  // 지평선 쪽을 넓게 써서 개방감을 준다
  vec3 c = h < 0.5
    ? mix(uBottom, uMid, smoothstep(0.18, 0.5, h))
    : mix(uMid, uTop, smoothstep(0.5, 0.94, h));

  // 해 / 달 원반 + 옅은 후광
  vec3 s = normalize(uDiscDir);
  float sd = dot(d, s);
  float disc = smoothstep(0.9989, 0.9996, sd);
  float halo = smoothstep(0.985, 1.0, sd) * 0.2;
  c = mix(c, uDisc, clamp(disc + halo, 0.0, 1.0));

  // 별 (밤에만). 화면에 보이는 하늘은 지평선 부근뿐이라
  // 고도에 따른 감쇠를 아주 완만하게 둬야 실제로 보인다.
  if (uStar > 0.004) {
    vec3 grid = d * 180.0;
    vec3 cell = floor(grid);
    float r = hash13(cell);
    // 칸 안에서 중심으로부터의 거리로 동그란 별을 만든다 (네모난 점 방지)
    float shape = 1.0 - smoothstep(0.06, 0.26, length(fract(grid) - 0.5));
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.1 + r * 51.0);
    float star = smoothstep(0.988, 0.9975, r) * shape * twinkle * uStar;
    star *= smoothstep(-0.16, 0.06, d.y);
    c = mix(c, uDisc, clamp(star, 0.0, 1.0));
  }

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(radius = 420) {
    this.material = new ShaderMaterial({
      uniforms: {
        uTop: { value: new Color() },
        uMid: { value: new Color() },
        uBottom: { value: new Color() },
        uDisc: { value: new Color() },
        uDiscDir: { value: new Vector3(0, 1, 0) },
        uStar: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });

    this.mesh = new Mesh(new SphereGeometry(radius, 32, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.name = 'sky';
  }

  update(state: SkyState, elapsed: number): void {
    const u = this.material.uniforms;
    (u.uTop!.value as Color).copy(state.skyTop);
    (u.uMid!.value as Color).copy(state.skyMid);
    (u.uBottom!.value as Color).copy(state.skyBottom);
    (u.uDisc!.value as Color).copy(state.disc);
    (u.uDiscDir!.value as Vector3).copy(state.discDir);
    u.uStar!.value = state.starIntensity;
    u.uTime!.value = elapsed;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
