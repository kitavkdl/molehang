import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  ShaderMaterial,
} from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { FX_COLORS, int } from '../style/palette.ts';
import { BOAT_YAW, HULL } from './hull.ts';
import { sampleWave } from './ocean.ts';

/**
 * 배가 물에 닿는 자리의 포말 링.
 *
 * 없으면 배가 물 위에 **얹혀만** 있는 것처럼 보인다. 이 링 하나로 배가 물에 잠긴다.
 * 가장자리가 울퉁불퉁한 납작한 고리 두 겹이 서로 반대로 아주 천천히 돈다.
 */
const VERT = /* glsl */ `
attribute float aEdge;
varying float vEdge;
void main() {
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vEdge;

void main() {
  // 안쪽/바깥쪽 끝에서만 부드럽게 사라진다 — 가운데는 완전 단색
  float a = smoothstep(0.0, 0.28, vEdge) * (1.0 - smoothstep(0.66, 1.0, vEdge));
  a *= uOpacity;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/** 가장자리가 물결치는 타원 고리 */
function buildRing(rx: number, rz: number, thickness: number, wobble: number, seed: number): BufferGeometry {
  const segments = 72;
  const pos: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const w = 1 + wobble * Math.sin(a * 5 + seed) * Math.cos(a * 3 - seed * 1.7);
    const inner = 1 - thickness * w;
    pos.push(Math.cos(a) * rx * inner, 0, Math.sin(a) * rz * inner);
    edge.push(0);
    pos.push(Math.cos(a) * rx * w, 0, Math.sin(a) * rz * w);
    edge.push(1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aEdge', new Float32BufferAttribute(edge, 1));
  geo.setIndex(idx);
  return geo;
}

export class Foam {
  readonly group = new Group();
  private readonly materials: ShaderMaterial[] = [];
  private readonly meshes: Mesh[] = [];

  constructor() {
    const rings = [
      { rx: HULL.beam * 0.78, rz: HULL.length * 0.56, thick: 0.34, wobble: 0.08, seed: 1.2, color: FX_COLORS.foamBright, opacity: 0.95, spin: 0.05 },
      { rx: HULL.beam * 1.12, rz: HULL.length * 0.7, thick: 0.28, wobble: 0.12, seed: 2.7, color: FX_COLORS.foam, opacity: 0.7, spin: -0.035 },
    ];

    for (const r of rings) {
      const material = new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(int(r.color)) },
          uOpacity: { value: r.opacity },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new Mesh(buildRing(r.rx, r.rz, r.thick, r.wobble, r.seed), material);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = BOAT_YAW;
      mesh.renderOrder = 3;
      mesh.userData.spin = r.spin;
      this.materials.push(material);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    this.group.name = 'foam';
  }

  update(state: SkyState, elapsed: number, seaX = 0, seaZ = 0): void {
    // 물결과 같이 오르내린다 — 항해 중에는 배가 있는 바다 좌표의 물결을 따라간다
    const y = sampleWave(seaX, seaZ, elapsed).height + 0.03;
    for (const mesh of this.meshes) {
      mesh.position.y = y;
      mesh.rotation.y = BOAT_YAW + elapsed * (mesh.userData.spin as number);
      const pulse = 1 + 0.035 * Math.sin(elapsed * 1.4 + (mesh.userData.spin as number) * 30);
      mesh.scale.set(pulse, 1, pulse);
    }
    // 밤에는 포말도 달빛 색을 따라간다
    (this.materials[1]!.uniforms.uColor!.value as Color).copy(state.oceanCrest);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
