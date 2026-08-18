import { BufferGeometry, Group, IcosahedronGeometry, Mesh, Object3D } from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { skyY } from './framing.ts';

/**
 * 로우폴리 구름 덩어리.
 *
 * 텍스처 없이 저해상도 정이십면체 몇 개를 겹쳐 만든다.
 * 높이는 `skyY(깊이, 고도)` 로 잡아 **보이는 하늘 띠 안**에 정확히 앉힌다 —
 * 카메라를 바꿔도 구름이 화면 밖으로 새지 않는다. (CLAUDE.md §4.1)
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

const SPAN = 460;

export class Clouds {
  readonly group = new Group();
  private readonly material: FlatMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly items: Array<{ object: Object3D; speed: number }> = [];

  constructor(count = 18) {
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

      // 수평선 가까이 낮게 깔리는 층과, 머리 위로 지나가는 층
      const low = i % 3 === 0;
      const depth = low ? 130 + random() * 150 : 55 + random() * 90;
      const elevation = low ? 0.8 + random() * 2.4 : 4 + random() * 9;
      const scale = low ? 3.4 + random() * 3.6 : 1.6 + random() * 2.4;

      cloud.scale.setScalar(scale);
      cloud.position.set((random() - 0.5) * SPAN, skyY(depth, elevation), -depth);

      this.items.push({ object: cloud, speed: (low ? 0.5 : 1.1) + random() * 1.4 });
      this.group.add(cloud);
    }

    this.group.name = 'clouds';
  }

  update(state: SkyState, dt: number): void {
    this.material.setColor(state.cloud);

    for (const item of this.items) {
      item.object.position.x += item.speed * dt;
      if (item.object.position.x > SPAN / 2) item.object.position.x -= SPAN;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
