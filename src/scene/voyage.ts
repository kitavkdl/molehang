import { Group, Mesh, OctahedronGeometry, type BufferGeometry } from 'three';
import { flat, type FlatMaterial } from './flat-material.ts';

/**
 * 항해모드 — WASD(또는 화면 끌기)로 배를 몬다. 가끔 암초가 나온다.
 *
 * 설계의 핵심: **배는 원점에서 한 발짝도 움직이지 않는다.** 움직이는 것은 바다다.
 *   - 배의 "바다 위 위치"(seaX, seaZ)만 여기서 적분한다.
 *   - 바다 셰이더는 파도 위상을 seaX/seaZ 만큼 밀고(ocean.ts uOffset),
 *     암초는 (암초 좌표 − 배 좌표) 자리에 그려진다.
 *   - 덕분에 §4.1 의 구도, §4.8 의 망원경, 배치 드래그가 전부 **그대로** 동작한다.
 *     카메라는 여전히 회전하지 않는다 — 항해도 같은 쪽에서 본다.
 *
 * 암초에 부딪히면 튕겨날 뿐, 벌점은 없다. 대신 따개비가 붙는다(부착은 main.ts 가
 * onHit 을 받아 게이트웨이로 처리한다). 협동과 마찬가지로 실패를 만들지 않는다.
 *
 * 키는 e.code 로 읽는다 — 한글 자판에서도 WASD 물리 위치가 그대로 먹게.
 */

/** 동시에 떠 있는 암초 수 */
const REEF_MAX = 7;
/** 새 암초가 나타나는 거리 (이 안쪽이면 갑자기 눈앞에 솟는다) */
const SPAWN_NEAR = 42;
const SPAWN_FAR = 85;
/** 이 거리보다 멀어진 암초는 치운다 */
const CULL_DIST = 130;
/** 충돌 판정용 배 반경 — 선체 길이 6.3 의 절반보다 약간 작게 */
const BOAT_RADIUS = 2.6;
/** 연타 방지 — 한 번 부딪히면 이 시간 안에는 다시 안 부딪힌다 */
const HIT_COOLDOWN = 1.3;
/** 부딪히면 이 속도로 튕겨 나간다 */
const KNOCKBACK = 5;
/** 기본 항해 속도 (유닛/초). 엔진·돛이 speedBonus 로 얹힌다 */
const BASE_SPEED = 3.2;
/** 화면 끌기 조이스틱 — 이 픽셀 거리에서 최대 속도가 된다 */
const STICK_RANGE = 70;

interface Reef {
  x: number;
  z: number;
  r: number;
  mesh: Group;
}

export class Voyage {
  /** 암초들이 담기는 그룹 — 월드 좌표 (배 기준 상대 위치로 매 프레임 갱신) */
  readonly group = new Group();

  active = false;
  /** 배가 바다 위 어디에 있는가 — 바다 스크롤 오프셋이기도 하다 */
  seaX = 0;
  seaZ = 0;
  vx = 0;
  vz = 0;
  /** 부품 효과(엔진·돛·외륜)로 붙는 속도 보너스 */
  speedBonus = 0;

  private reefs: Reef[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly rock: FlatMaterial;
  private readonly rockDark: FlatMaterial;
  private readonly rockMoss: FlatMaterial;
  private readonly collar: FlatMaterial;

  private readonly keys = new Set<string>();
  private pointerId: number | null = null;
  private stickX = 0;
  private stickZ = 0;
  private startX = 0;
  private startY = 0;

  private lastHit = -Infinity;
  private spawnTimer = 0;
  private readonly hitListeners = new Set<() => void>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.rock = flat('steel');
    this.rockDark = flat('rust');
    this.rockMoss = flat('moss');
    this.collar = flat('cream');

    this.group.name = 'reefs';

    globalThis.addEventListener('keydown', this.onKeyDown);
    globalThis.addEventListener('keyup', this.onKeyUp);
    // W 를 누른 채 창을 옮기면 keyup 이 영영 안 온다 — 초점을 잃으면 키를 전부 놓는다.
    // 안 그러면 배가 혼자 수평선까지 항해한다.
    globalThis.addEventListener('blur', this.onRelease);
    document.addEventListener('visibilitychange', this.onRelease);
    this.canvas.addEventListener('pointerdown', this.onDown);
    globalThis.addEventListener('pointermove', this.onMove);
    globalThis.addEventListener('pointerup', this.onUp);
    globalThis.addEventListener('pointercancel', this.onUp);
  }

  dispose(): void {
    globalThis.removeEventListener('keydown', this.onKeyDown);
    globalThis.removeEventListener('keyup', this.onKeyUp);
    globalThis.removeEventListener('blur', this.onRelease);
    document.removeEventListener('visibilitychange', this.onRelease);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    globalThis.removeEventListener('pointermove', this.onMove);
    globalThis.removeEventListener('pointerup', this.onUp);
    globalThis.removeEventListener('pointercancel', this.onUp);
    for (const g of this.geometries) g.dispose();
    this.rock.dispose();
    this.rockDark.dispose();
    this.rockMoss.dispose();
    this.collar.dispose();
  }

  onHit(fn: () => void): () => void {
    this.hitListeners.add(fn);
    return () => this.hitListeners.delete(fn);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.keys.clear();
    this.stickX = 0;
    this.stickZ = 0;
    this.pointerId = null;
    if (active && this.reefs.length === 0) this.seedReefs();
    if (!active) {
      this.vx = 0;
      this.vz = 0;
    }
    // 바다 위치(seaX/seaZ)는 남긴다 — 다음 항해는 정박한 자리에서 이어진다.
    // 암초도 그대로 둔다: 정박 중에 옆에 보이는 바위는 그냥 풍경이다.
  }

  /**
   * 첫 항해의 암초들 — 하나는 **반드시 정면**에 둔다.
   * 전부 난수에 맡기면 "암초라더니 아무것도 없는데?" 로 끝나는 첫 항해가 나온다.
   */
  private seedReefs(): void {
    this.addReef(this.seaX + 3, this.seaZ - 27, 1.5);
    this.addReef(this.seaX - 16, this.seaZ - 48, 1.2);
    this.addReef(this.seaX + 22, this.seaZ - 60, 1.9);
  }

  update(dt: number, elapsed: number): void {
    if (this.active) {
      // --- 입력: 키보드(물리 자리) + 화면 조이스틱 ---
      let ix = this.stickX;
      let iz = this.stickZ;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
      const mag = Math.hypot(ix, iz);
      if (mag > 1) {
        ix /= mag;
        iz /= mag;
      }

      const max = BASE_SPEED + this.speedBonus;
      const ease = Math.min(1, dt * 3.4);
      this.vx += (ix * max - this.vx) * ease;
      this.vz += (iz * max - this.vz) * ease;

      this.seaX += this.vx * dt;
      this.seaZ += this.vz * dt;

      // --- 암초 보충 ---
      this.spawnTimer -= dt;
      if (this.reefs.length < REEF_MAX && this.spawnTimer <= 0) {
        this.spawnAhead();
        this.spawnTimer = 2 + Math.random() * 2.5;
      }
    }

    // --- 암초 배치·정리·충돌 (정박 중에도 상대 위치는 맞춰 둔다) ---
    for (let i = this.reefs.length - 1; i >= 0; i--) {
      const reef = this.reefs[i]!;
      const dx = reef.x - this.seaX;
      const dz = reef.z - this.seaZ;
      const dist = Math.hypot(dx, dz);

      if (dist > CULL_DIST) {
        this.group.remove(reef.mesh);
        this.reefs.splice(i, 1);
        continue;
      }

      // 바위는 물결에 얹히지 않는다 — 뿌리가 바다 밑까지 닿은 물체라는 감각
      reef.mesh.position.set(dx, 0, dz);

      if (
        this.active &&
        dist < reef.r + BOAT_RADIUS &&
        elapsed - this.lastHit > HIT_COOLDOWN &&
        dist > 1e-3
      ) {
        this.lastHit = elapsed;
        // 암초 반대쪽으로 튕겨 나간다. 벌점은 없다 — 따개비가 붙을 뿐이다(main.ts)
        const nx = -dx / dist;
        const nz = -dz / dist;
        this.vx = nx * KNOCKBACK;
        this.vz = nz * KNOCKBACK;
        for (const fn of this.hitListeners) fn();
      }
    }
  }

  /** 진행 방향 앞쪽 부챗살 안 어딘가에 암초 하나 */
  private spawnAhead(): void {
    const speed = Math.hypot(this.vx, this.vz);
    // 서 있으면 수평선 쪽(-z)이 "앞"이다
    const dirX = speed > 0.5 ? this.vx / speed : 0;
    const dirZ = speed > 0.5 ? this.vz / speed : -1;

    const spread = (Math.random() - 0.5) * 1.7;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const ax = dirX * cos - dirZ * sin;
    const az = dirX * sin + dirZ * cos;

    const dist = SPAWN_NEAR + Math.random() * (SPAWN_FAR - SPAWN_NEAR);
    this.addReef(this.seaX + ax * dist, this.seaZ + az * dist, 1 + Math.random() * 1.1);
  }

  private addReef(x: number, z: number, r: number): void {
    const mesh = this.buildReef(r);
    mesh.position.set(x - this.seaX, 0, z - this.seaZ);
    this.group.add(mesh);
    this.reefs.push({ x, z, r, mesh });
  }

  /** 로우폴리 바위 — 큰 덩이 + 곁돌 + 이끼 모자 + 물때 띠. 전부 팔레트 flat() */
  private buildReef(r: number): Group {
    const group = new Group();
    const keep = (geo: BufferGeometry): BufferGeometry => {
      this.geometries.push(geo);
      return geo;
    };

    const main = new Mesh(keep(new OctahedronGeometry(r, 0)), this.rock);
    main.scale.y = 1.35;
    main.position.y = r * 0.35 - 0.45;
    main.rotation.y = Math.random() * Math.PI;

    const side = new Mesh(keep(new OctahedronGeometry(r * 0.55, 0)), this.rockDark);
    side.position.set(r * 0.7, r * 0.1 - 0.4, r * 0.25);
    side.rotation.y = Math.random() * Math.PI;

    const cap = new Mesh(keep(new OctahedronGeometry(r * 0.34, 0)), this.rockMoss);
    cap.position.y = r * 1.35 - 0.35;

    // 수면에 걸치는 밝은 띠 — 포말 셰이더 없이도 "물에 잠긴 바위"로 읽히게 한다
    const ring = new Mesh(keep(new OctahedronGeometry(r * 1.12, 0)), this.collar);
    ring.scale.y = 0.1;
    ring.position.y = 0.02;
    ring.rotation.y = Math.random() * Math.PI;

    group.add(main, side, cap, ring);
    return group;
  }

  // --- 입력 리스너 ---

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    const target = e.target as HTMLElement | null;
    if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (KEYS.has(e.code)) {
      this.keys.add(e.code);
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onRelease = (): void => {
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    this.keys.clear();
    this.stickX = 0;
    this.stickZ = 0;
    this.pointerId = null;
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.active || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    // 누른 자리에서 끈 방향이 곧 타륜 — 위로 끌면 수평선 쪽(-z)으로 나아간다
    this.stickX = clamp((e.clientX - this.startX) / STICK_RANGE);
    this.stickZ = clamp((e.clientY - this.startY) / STICK_RANGE);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.stickX = 0;
    this.stickZ = 0;
  };
}

const KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function clamp(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
