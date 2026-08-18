import { BufferGeometry, Group, Mesh } from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { skyY } from './framing.ts';
import { toGeometry } from './hull.ts';

/**
 * 하늘을 도는 새 몇 마리.
 *
 * 정지된 바다 사진에 생명을 넣는 가장 싼 장치다. 삼각형 두 개짜리 V 실루엣이고,
 * 날갯짓은 그룹 회전으로만 준다.
 */
interface Bird {
  group: Group;
  left: Mesh;
  right: Mesh;
  radius: number;
  phase: number;
  speed: number;
  flap: number;
  y: number;
}

function wingGeometry(span: number): BufferGeometry {
  return toGeometry(
    [0, 0, 0, span, span * 0.22, -span * 0.2, span * 0.92, 0, span * 0.16],
    [0, 1, 2],
  );
}

export class Birds {
  readonly group = new Group();
  private readonly material: FlatMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly birds: Bird[] = [];

  constructor(count = 7) {
    this.material = flat('indigo');

    for (let i = 0; i < count; i++) {
      const span = 0.5 + (i % 3) * 0.12;
      const geoL = wingGeometry(span);
      const geoR = wingGeometry(span);
      this.geometries.push(geoL, geoR);

      const bird = new Group();
      const left = new Mesh(geoL, this.material);
      const right = new Mesh(geoR, this.material);
      right.scale.x = -1;
      bird.add(left, right);

      const depth = 46 + (i % 4) * 22;
      this.birds.push({
        group: bird,
        left,
        right,
        radius: depth * 0.34,
        phase: (i / count) * Math.PI * 2,
        speed: 0.06 + (i % 3) * 0.015,
        flap: 3.4 + (i % 5) * 0.5,
        y: skyY(depth, 3.2 + (i % 4) * 2.1),
      });
      bird.position.z = -depth;
      this.group.add(bird);
    }

    this.group.name = 'birds';
  }

  update(state: SkyState, elapsed: number): void {
    this.material.setColor(state.island);

    for (const b of this.birds) {
      const a = b.phase + elapsed * b.speed;
      b.group.position.set(Math.cos(a) * b.radius, b.y + Math.sin(a * 2) * 1.1, b.group.position.z);
      b.group.rotation.y = -a + Math.PI / 2;

      const flap = Math.sin(elapsed * b.flap + b.phase) * 0.55;
      b.left.rotation.z = flap;
      b.right.rotation.z = -flap;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
  }
}
