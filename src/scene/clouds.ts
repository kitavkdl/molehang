import { BufferGeometry, Group, IcosahedronGeometry, Mesh, Object3D } from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { PORTRAIT, skyBandFloorY, underSeaCeilY } from './framing.ts';
import { SEA_RADIUS } from './ocean.ts';

/**
 * 로우폴리 구름 덩어리.
 *
 * 텍스처 없이 저해상도 정이십면체 몇 개를 겹쳐 만든다.
 * 바다 원반의 위/아래로 흩어 놓아 "하늘에 떠 있다"는 느낌을 만든다.
 */

interface Blob {
  x: number;
  y: number;
  z: number;
  r: number;
}

const SHAPES: Blob[][] = [
  [
    { x: 0, y: 0, z: 0, r: 1.5 },
    { x: 1.5, y: -0.2, z: 0.2, r: 1.05 },
    { x: -1.35, y: -0.3, z: -0.15, r: 0.95 },
    { x: 0.5, y: 0.75, z: -0.1, r: 0.9 },
  ],
  [
    { x: 0, y: 0, z: 0, r: 1.2 },
    { x: 1.25, y: 0.25, z: 0.1, r: 0.95 },
    { x: -1.05, y: 0.1, z: 0.2, r: 0.8 },
  ],
  [
    { x: 0, y: 0, z: 0, r: 1.75 },
    { x: 1.9, y: -0.35, z: 0.25, r: 1.15 },
    { x: -1.75, y: -0.15, z: -0.2, r: 1.25 },
    { x: 0.15, y: 0.95, z: 0.3, r: 1.0 },
    { x: -0.9, y: 0.7, z: -0.25, r: 0.75 },
  ],
];

/** 결정적 난수 — 새로고침해도 구름 배치가 같도록 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const DRIFT_SPAN = SEA_RADIUS * 6;

export class Clouds {
  readonly group = new Group();
  private readonly material: FlatMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly items: Array<{ object: Object3D; speed: number }> = [];

  constructor(count = 16) {
    // 색은 매 프레임 시간대에 맞춰 갈아끼운다 — 여기 값은 첫 프레임용
    this.material = flat('cream');
    const random = rng(20260817);

    for (let i = 0; i < count; i++) {
      const shape = SHAPES[Math.floor(random() * SHAPES.length)]!;
      const cloud = new Group();

      for (const b of shape) {
        const geo = new IcosahedronGeometry(b.r, 0);
        this.geometries.push(geo);
        const mesh = new Mesh(geo, this.material);
        mesh.position.set(b.x, b.y, b.z);
        mesh.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
        // 살짝 납작하게 눌러 구름다운 실루엣으로
        mesh.scale.set(1, 0.72, 1);
        cloud.add(mesh);
      }

      // 구름은 두 층으로 나눈다.
      //  - 먼 하늘층: 원반 너머, 가려지지 않는 높이까지만 내려서 수평선 위에 걸리게
      //  - 아래층: 바다 원반보다 **낮은 고도**. 앞쪽 가장자리 아래로 지나가면서
      //            "이 바다는 공중에 떠 있다"를 한눈에 만들어 준다.
      const low = i % 5 < 2;
      const x = (random() - 0.5) * DRIFT_SPAN;
      let y: number;
      let z: number;

      if (low) {
        // 바다 **밑**을 흐르는 구름. 앞 가장자리 아래 좁은 띠에 정확히 걸리도록
        // 깊이에 맞춰 높이를 낮춘다. 이 층이 "떠 있다"를 가장 강하게 만든다.
        // 가까우면 화면을 다 덮어버리니 충분히 멀리 둔다.
        z = -SEA_RADIUS - random() * SEA_RADIUS * 5.5;
        y = underSeaCeilY(PORTRAIT.distance - z) - (1.5 + random() * 4);
      } else {
        z = -SEA_RADIUS * 1.8 - random() * SEA_RADIUS * 9;
        y = skyBandFloorY(PORTRAIT.distance - z) + 1.5 + random() * (11 + random() * 10);
      }

      cloud.scale.setScalar(low ? 0.9 + random() * 1.1 : 1.2 + random() * 1.9);
      cloud.position.set(x, y, z);

      this.items.push({ object: cloud, speed: 0.28 + random() * 0.42 });
      this.group.add(cloud);
    }

    this.group.name = 'clouds';
  }

  update(state: SkyState, dt: number): void {
    this.material.setColor(state.cloud);

    for (const item of this.items) {
      item.object.position.x += item.speed * dt;
      if (item.object.position.x > DRIFT_SPAN / 2) {
        item.object.position.x -= DRIFT_SPAN;
      }
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
