import { Group, Mesh, OctahedronGeometry, Vector3, type BufferGeometry } from 'three';
import { flat, type FlatMaterial } from '../scene/flat-material.ts';
import { FX_COLORS } from '../style/palette.ts';

/**
 * 쌓인 자원 = 배 주위를 도는 작은 결정들.
 * 수거하면 전부 갑판 상자로 빨려 들어간다. (CLAUDE.md §2-3)
 */
const COUNT = 18;
const FLIGHT = 0.62;

type Mode = 'idle' | 'fly';

interface Mote {
  mesh: Mesh;
  angle: number;
  radius: number;
  baseY: number;
  spin: number;
  mode: Mode;
  t: number;
  delay: number;
  from: Vector3;
  ctrl: Vector3;
}

const easeIn = (t: number): number => t * t * t;

export class Motes {
  readonly group = new Group();
  private readonly motes: Mote[] = [];
  private readonly materials: FlatMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private visible = 0;
  private readonly tmp = new Vector3();

  constructor() {
    const matA = flat(FX_COLORS.mote);
    const matB = flat(FX_COLORS.moteAlt);
    this.materials.push(matA, matB);

    for (let i = 0; i < COUNT; i++) {
      const geo = new OctahedronGeometry(0.115 + (i % 3) * 0.022, 0);
      this.geometries.push(geo);
      const mesh = new Mesh(geo, i % 4 === 0 ? matB : matA);
      mesh.visible = false;

      this.motes.push({
        mesh,
        angle: (i / COUNT) * Math.PI * 2 + (i % 3) * 0.4,
        // 선체(길이 6.3 / 폭 2.4) 바깥을 돌도록 — 안쪽으로 파고들면 지저분해진다
        radius: 3.4 + ((i * 7) % 5) * 0.3,
        baseY: 0.9 + ((i * 3) % 4) * 0.4,
        spin: 0.6 + ((i * 5) % 7) * 0.12,
        mode: 'idle',
        t: 0,
        delay: 0,
        from: new Vector3(),
        ctrl: new Vector3(),
      });
      this.group.add(mesh);
    }

    this.group.name = 'motes';
  }

  /** 자원 보유 비율(0~1)에 따라 떠 있는 개수가 늘어난다 */
  setFill(fill: number): void {
    this.visible = Math.round(Math.max(0, Math.min(1, fill)) * COUNT);
  }

  /** 수거 — 지금 떠 있는 결정 전부를 목표점으로 날려 보낸다 */
  burst(target: Vector3): void {
    let n = 0;
    for (const m of this.motes) {
      if (!m.mesh.visible || m.mode === 'fly') continue;
      m.mode = 'fly';
      m.t = 0;
      m.delay = n * 0.026;
      m.from.copy(m.mesh.position);
      // 살짝 위로 솟았다가 빨려 들어가도록 제어점을 띄운다
      m.ctrl.copy(m.from).lerp(target, 0.45);
      m.ctrl.y += 0.75;
      n++;
    }
  }

  update(elapsed: number, dt: number, target: Vector3): void {
    let idleIndex = 0;

    for (const m of this.motes) {
      if (m.mode === 'fly') {
        m.t += dt;
        const local = Math.max(0, m.t - m.delay);
        const k = Math.min(1, local / FLIGHT);
        const e = easeIn(k);

        // from -> ctrl -> target 2차 베지어
        const inv = 1 - e;
        this.tmp
          .copy(m.from)
          .multiplyScalar(inv * inv)
          .addScaledVector(m.ctrl, 2 * inv * e)
          .addScaledVector(target, e * e);
        m.mesh.position.copy(this.tmp);
        m.mesh.scale.setScalar(1 - e * 0.95);
        m.mesh.rotation.y += dt * 9;
        m.mesh.rotation.x += dt * 6;

        if (k >= 1) {
          m.mode = 'idle';
          m.mesh.visible = false;
          m.mesh.scale.setScalar(1);
        }
        continue;
      }

      const shouldShow = idleIndex < this.visible;
      idleIndex++;
      m.mesh.visible = shouldShow;
      if (!shouldShow) continue;

      const a = m.angle + elapsed * 0.24;
      m.mesh.position.set(
        Math.cos(a) * m.radius,
        m.baseY + Math.sin(elapsed * 1.15 + m.angle * 2) * 0.16,
        Math.sin(a) * m.radius * 1.15,
      );
      m.mesh.rotation.y += dt * m.spin;
      m.mesh.rotation.x += dt * m.spin * 0.6;
      m.mesh.scale.setScalar(1);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
