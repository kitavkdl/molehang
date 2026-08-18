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
import { FX_COLORS, int } from '../style/palette.ts';
import { HULL } from './hull.ts';
import { sampleWave } from './ocean.ts';

/**
 * 항적 — 달리는 배의 선미 뒤로 남는 포말 자국.
 *
 * 이게 없으면 바다만 흐르고 배는 제자리라 "미끄러진다"는 감각이 안 생긴다.
 * 포말 조각을 배가 지나간 **바다 좌표**에 떨어뜨려 두면, 바다가 흐르는 구조
 * (§4.9 — 배는 원점, 바다가 흐른다) 덕분에 조각들이 저절로 뒤로 밀려나며
 * 항적이 된다. 조각은 퍼지면서 옅어지다 사라진다.
 *
 * foam.ts 의 링과 같은 문법: 반투명 단색, 부드러운 가장자리, 텍스처 없음.
 */

/** 풀 크기 — 최고 속도로 달려도 수명이 다한 조각이 먼저 나온다 */
const POOL = 26;
/** 조각 하나의 수명 (초) */
const LIFE = 2.4;
/** 이만큼 항해할 때마다 조각 하나 (유닛) */
const EMIT_EVERY = 1.05;
/** 이 속도 밑에서는 항적이 안 남는다 — 표류는 항해가 아니다 */
const MIN_SPEED = 0.7;

/** 갓 태어난 조각의 색 (팔레트 cream) */
const FOAM_BRIGHT = new Color(int(FX_COLORS.foamBright));

const VERT = /* glsl */ `
attribute float aR;
varying float vR;
void main() {
  vR = aR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vR;
void main() {
  // 가운데는 단색, 가장자리만 부드럽게 사라진다
  float a = (1.0 - smoothstep(0.4, 1.0, vR)) * uOpacity;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/** 가장자리가 살짝 우는 납작한 원판 — 포말 조각 하나 */
function buildPatch(seed: number): BufferGeometry {
  const segments = 22;
  const pos: number[] = [0, 0, 0];
  const r: number[] = [0];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const w = 1 + 0.16 * Math.sin(a * 4 + seed) * Math.cos(a * 3 - seed);
    pos.push(Math.cos(a) * w, 0, Math.sin(a) * w);
    r.push(1);
  }
  for (let i = 1; i <= segments; i++) idx.push(0, i, i + 1);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('aR', new Float32BufferAttribute(r, 1));
  geo.setIndex(idx);
  return geo;
}

interface Patch {
  mesh: Mesh;
  material: ShaderMaterial;
  x: number;
  z: number;
  size: number;
  age: number;
  active: boolean;
}

export class Wake {
  readonly group = new Group();
  private readonly patches: Patch[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private acc = 0;
  /** 좌현/우현 번갈아 떨어뜨린다 — 한 줄이 아니라 V 자 두 줄이 항적이다 */
  private side = 1;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const geo = buildPatch(i * 1.7);
      this.geometries.push(geo);
      const material = new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(int(FX_COLORS.foamBright)) },
          uOpacity: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        // 생성 지오메트리 + 커스텀 셰이더 = 와인딩에 따라 통째로 사라진다 (§4.2)
        side: DoubleSide,
      });
      const mesh = new Mesh(geo, material);
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.group.add(mesh);
      this.patches.push({ mesh, material, x: 0, z: 0, size: 1, age: 0, active: false });
    }
    this.group.name = 'wake';
  }

  update(
    state: SkyState,
    elapsed: number,
    dt: number,
    seaX: number,
    seaZ: number,
    vx: number,
    vz: number,
  ): void {
    const speed = Math.hypot(vx, vz);

    // --- 새 조각 — 지나온 거리 기준. 시간 기준이면 느릴 때 조각이 겹쳐 뭉친다 ---
    if (speed > MIN_SPEED) {
      this.acc += speed * dt;
      const dirX = vx / speed;
      const dirZ = vz / speed;
      while (this.acc >= EMIT_EVERY) {
        this.acc -= EMIT_EVERY;
        this.side = -this.side;
        // 선미 뒤, 좌우로 조금 벌어진 자리 (진행 방향의 수직 = (-dirZ, dirX))
        const back = HULL.length * 0.42;
        const lat = this.side * (HULL.beam * 0.42 + Math.random() * 0.35);
        this.emit(
          seaX - dirX * back - dirZ * lat,
          seaZ - dirZ * back + dirX * lat,
          0.55 + Math.random() * 0.3 + speed * 0.04,
        );
      }
    } else {
      this.acc = 0;
    }

    // --- 조각들 — 퍼지고 옅어진다. 바다 좌표에 붙박여 있어 저절로 뒤로 흐른다 ---
    for (const p of this.patches) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= LIFE) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      const k = p.age / LIFE;
      const spread = p.size * (0.6 + k * 1.5);
      p.mesh.scale.set(spread, 1, spread);
      p.material.uniforms.uOpacity!.value = (1 - k) ** 1.5 * 0.85;
      // 배 밑 포말 링(foam.ts)의 밝은 안쪽 링과 같은 크림색 고정 —
      // 낮 바다의 마루색(foam)과 같으면 항적이 물결에 묻혀 안 보인다.
      // 갓 태어난 조각만 진하고 뒤로 갈수록 마루색으로 식는다.
      (p.material.uniforms.uColor!.value as Color)
        .copy(FOAM_BRIGHT)
        .lerp(state.oceanCrest, k * 0.7);
      const y = sampleWave(p.x, p.z, elapsed).height + 0.04;
      p.mesh.position.set(p.x - seaX, y, p.z - seaZ);
    }
  }

  private emit(x: number, z: number, size: number): void {
    const slot = this.patches.find((p) => !p.active) ?? this.patches[0]!;
    slot.active = true;
    slot.age = 0;
    slot.x = x;
    slot.z = z;
    slot.size = size;
    slot.mesh.visible = true;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const p of this.patches) p.material.dispose();
  }
}
