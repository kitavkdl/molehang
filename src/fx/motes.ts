import {
  CylinderGeometry,
  Group,
  Mesh,
  OctahedronGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { flat, type FlatMaterial } from '../scene/flat-material.ts';
import { FX_COLORS } from '../style/palette.ts';
import { boxGeometry } from '../scene/hull.ts';
import { sampleWave } from '../scene/ocean.ts';

/**
 * 쌓인 자원 = 배 주위 **물 위에 떠다니는 고철 조각들**. 수거하면 전부 갑판 상자로
 * 빨려 들어간다. (CLAUDE.md §2-3)
 *
 * 처음에는 공중 궤도를 도는 추상 결정이었는데, 자원이 적을 때 결정 하나가
 * 허공에 둥둥 떠 "정체불명의 파티클"로 읽혔다. 그래서 물 위로 내렸다 —
 * 고철은 물에 떠내려와 배 곁에 모이는 것이 세계관에도 맞는다.
 *
 * 조각 하나 = 찌그러진 강판 + 금빛 덩이 + 녹슨 봉. 팔레트 flat() 만 쓴다.
 */
const COUNT = 12;
const FLIGHT = 0.62;

type Mode = 'idle' | 'fly';

interface Mote {
  object: Group;
  base: number;
  angle: number;
  radius: number;
  drift: number;
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
    const steel = flat('steel');
    const rust = flat('rust');
    const gold = flat(FX_COLORS.mote);
    this.materials.push(steel, rust, gold);

    // 지오메트리는 전 조각이 공유한다 — 스케일·회전만 다르게
    const plateGeo = boxGeometry(0.3, 0.05, 0.22);
    const nuggetGeo = new OctahedronGeometry(0.1, 0);
    const rodGeo = new CylinderGeometry(0.025, 0.025, 0.34, 5, 1);
    this.geometries.push(plateGeo, nuggetGeo, rodGeo);

    for (let i = 0; i < COUNT; i++) {
      const object = new Group();

      // 찌그러진 강판 — 물에 비스듬히 얹혀 있다
      const plate = new Mesh(plateGeo, i % 4 === 0 ? rust : steel);
      plate.rotation.set(0.14 + (i % 3) * 0.1, (i * 1.7) % Math.PI, -0.1 + (i % 2) * 0.2);

      // 금빛 덩이 — "이건 자원이다"라고 말해 주는 조각
      const nugget = new Mesh(nuggetGeo, gold);
      nugget.position.set(0.05, 0.08, -0.03);
      nugget.rotation.y = i * 0.9;

      // 녹슨 봉 하나가 삐죽 걸쳐 있다
      const rod = new Mesh(rodGeo, i % 4 === 0 ? steel : rust);
      rod.position.set(-0.06, 0.05, 0.04);
      rod.rotation.set(0.35, (i * 2.3) % Math.PI, 1.25);

      object.add(plate, nugget, rod);
      const base = 0.8 + ((i * 5) % 4) * 0.14;
      object.scale.setScalar(base);
      object.visible = false;

      this.motes.push({
        object,
        base,
        angle: (i / COUNT) * Math.PI * 2 + (i % 3) * 0.4,
        // 배 가까이 붙어야 "배로 모이는 자원"으로 읽힌다.
        // 넓게 흩어 놓으면 바다에 떠다니는 쓰레기처럼 보인다.
        radius: 2.5 + ((i * 7) % 5) * 0.24,
        drift: 0.04 + ((i * 3) % 4) * 0.012,
        spin: 0.2 + ((i * 5) % 7) * 0.05,
        mode: 'idle',
        t: 0,
        delay: 0,
        from: new Vector3(),
        ctrl: new Vector3(),
      });
      this.group.add(object);
    }

    this.group.name = 'motes';
  }

  /** 자원 보유 비율(0~1)에 따라 떠 있는 개수가 늘어난다 */
  setFill(fill: number): void {
    this.visible = Math.round(Math.max(0, Math.min(1, fill)) * COUNT);
  }

  /** 수거 — 지금 떠 있는 조각 전부를 목표점으로 날려 보낸다 */
  burst(target: Vector3): void {
    let n = 0;
    for (const m of this.motes) {
      if (!m.object.visible || m.mode === 'fly') continue;
      m.mode = 'fly';
      m.t = 0;
      m.delay = n * 0.026;
      m.from.copy(m.object.position);
      // 물에서 솟구쳤다가 빨려 들어가도록 제어점을 띄운다
      m.ctrl.copy(m.from).lerp(target, 0.45);
      m.ctrl.y += 0.9;
      n++;
    }
  }

  /**
   * 조각들은 배를 따라다니는 작은 선단처럼 **물결에 얹혀** 오르내린다.
   * 항해 중에는 배의 바다 좌표(seaX/seaZ)의 물결을 타야 배와 같은 물을 탄다.
   */
  update(elapsed: number, dt: number, target: Vector3, seaX = 0, seaZ = 0): void {
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
        m.object.position.copy(this.tmp);
        m.object.scale.setScalar(Math.max(0.01, m.base * (1 - e * 0.95)));
        m.object.rotation.y += dt * 9;
        m.object.rotation.x += dt * 6;

        if (k >= 1) {
          m.mode = 'idle';
          m.object.visible = false;
          m.object.scale.setScalar(m.base);
          m.object.rotation.set(0, 0, 0);
        }
        continue;
      }

      const shouldShow = idleIndex < this.visible;
      idleIndex++;
      m.object.visible = shouldShow;
      if (!shouldShow) continue;

      const a = m.angle + elapsed * m.drift;
      const x = Math.cos(a) * m.radius;
      const z = Math.sin(a) * m.radius * 1.3;
      // 물 위에 떠 있다 — 그 자리 물결의 높이와 기울기를 그대로 탄다
      const wave = sampleWave(seaX + x, seaZ + z, elapsed);
      m.object.position.set(x, wave.height + 0.05, z);
      m.object.rotation.z = wave.slopeX * 0.6;
      m.object.rotation.x = wave.slopeZ * 0.6;
      m.object.rotation.y += dt * m.spin;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
