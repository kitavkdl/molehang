import { CircleGeometry, Color, Mesh, ShaderMaterial } from 'three';
import { int, BOAT_COLORS } from '../style/palette.ts';
import { BOAT_YAW } from './hull.ts';
import { sampleWave } from './ocean.ts';

/**
 * 배 아래 그림자 — 섀도우맵 대신 연한 단색 블롭. (CLAUDE.md §3.3)
 * 가장자리만 부드럽게 빠지고 안쪽은 완전 단색이라 플랫 셰이딩과 충돌하지 않는다.
 */
const VERT = /* glsl */ `
varying vec2 vUvC;
void main() {
  vUvC = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUvC;

void main() {
  float d = length(vUvC);
  float a = (1.0 - smoothstep(0.55, 1.0, d)) * uOpacity;
  if (a <= 0.001) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

export class ShadowBlob {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(radius = 2.75) {
    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(int(BOAT_COLORS.shadow)) },
        uOpacity: { value: 0.26 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new Mesh(new CircleGeometry(radius, 24), this.material);
    // YXZ 순서라야 "세워서 돌린 뒤 눕히기"가 된다
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.set(-Math.PI / 2, BOAT_YAW, 0);
    this.mesh.renderOrder = 2;
    this.mesh.name = 'boat-shadow';
  }

  update(elapsed: number): void {
    // 물결 위에 얹혀 같이 출렁이게
    this.mesh.position.y = sampleWave(0, 0, elapsed).height + 0.035;
    const pulse = 1 + 0.04 * Math.sin(elapsed * 1.1);
    // 선체가 길쭉하니 그림자도 같은 비율로 늘린다
    this.mesh.scale.set(0.6 * pulse, pulse, 1);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
