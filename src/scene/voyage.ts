import {
  BufferGeometry,
  CylinderGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  OctahedronGeometry,
  ShaderMaterial,
} from 'three';
import { flat, type FlatMaterial } from './flat-material.ts';
import { FX_COLORS, int } from '../style/palette.ts';
import { sampleWave } from './ocean.ts';

/**
 * 항해모드 — WASD(또는 화면 끌기)로 배를 몬다. 풍경이 스쳐 지나간다.
 *
 * 설계의 핵심: **배는 원점에서 한 발짝도 움직이지 않는다.** 움직이는 것은 바다다.
 *   - 배의 "바다 위 위치"(seaX, seaZ)만 여기서 적분한다.
 *   - 바다 셰이더는 파도 위상을 seaX/seaZ 만큼 밀고(ocean.ts uOffset),
 *     소품은 (소품 좌표 − 배 좌표) 자리에 그려진다.
 *   - 덕분에 §4.1 의 구도, §4.8 의 망원경, 배치 드래그가 전부 **그대로** 동작한다.
 *     카메라는 여전히 회전하지 않는다 — 항해도 같은 쪽에서 본다.
 *
 * 바다 소품은 두 부류다.
 *   - 부딪히는 것(암초·바위기둥·모래섬): 튕겨나고 따개비가 붙는다. 벌점은 없다.
 *   - 스쳐 가는 풍경(부표·유목): 충돌하지 않는다. 지나가는 맛을 위해 있다.
 *
 * 모든 소품은 **물속에서 솟아오르며 등장**하고(포말 스플래시와 함께),
 * 정박하면 **차례로 가라앉아 사라진다.** 갑자기 나타나거나 사라지는 물체는 없다.
 *
 * 키는 e.code 로 읽는다 — 한글 자판에서도 WASD 물리 위치가 그대로 먹게.
 */

/** 동시에 떠 있는 소품 수 (충돌하는 것 + 풍경 합계) */
const PROP_MAX = 14;
/** 그중 부딪히는 소품(암초류)의 상한 — 바다가 장애물 코스가 되면 안 된다 */
const COLLIDE_MAX = 6;
/** 새 소품이 나타나는 거리 (이 안쪽이면 갑자기 눈앞에 솟는다) */
const SPAWN_NEAR = 42;
const SPAWN_FAR = 85;
/** 이 거리보다 멀어진 소품은 치운다 (화면 밖 — 연출 없이 즉시) */
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
/** 솟아오르기 / 가라앉기 시간 (초) */
const RISE_DUR = 0.8;
const SINK_DUR = 0.65;
/** 정박 시 소품들이 가라앉는 시차 — 한꺼번에 꺼지면 정전 같다 */
const SINK_STAGGER = 0.09;

type PropKind = 'reef' | 'spire' | 'islet' | 'buoy' | 'drift';

/** 뽑힐 확률 가중치 — 풍경(부표·유목)이 절반쯤 섞여야 "장애물 코스"가 아니라 "바다"다 */
const PROP_WEIGHTS: Array<{ kind: PropKind; weight: number }> = [
  { kind: 'reef', weight: 0.30 },
  { kind: 'spire', weight: 0.14 },
  { kind: 'islet', weight: 0.10 },
  { kind: 'buoy', weight: 0.22 },
  { kind: 'drift', weight: 0.24 },
];

interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** 충돌 반경 (풍경이면 시각 크기로만 쓴다) */
  r: number;
  collide: boolean;
  /** 물결에 얹혀 오르내리는가 (부표·유목). 바위는 뿌리가 바다 밑까지 닿아 있다 */
  floats: boolean;
  /** 등장/퇴장 때 잠수하는 깊이 */
  depth: number;
  mesh: Group;
  geos: BufferGeometry[];
  anim: 'rise' | 'idle' | 'sink';
  t: number;
  /** 가라앉기 시작까지의 지연 (정박 시 시차용) */
  delay: number;
  /** 지연이 끝나는 순간 스플래시를 한 번만 터뜨리기 위한 플래그 */
  splashed: boolean;
  /** 흔들림 위상 (부표·유목) */
  sway: number;
}

// --- 스플래시 링 셰이더 — foam.ts 와 같은 문법의 반투명 단색 고리 ---

const SPLASH_VERT = /* glsl */ `
attribute float aEdge;
varying float vEdge;
void main() {
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vEdge;
void main() {
  float a = smoothstep(0.0, 0.3, vEdge) * (1.0 - smoothstep(0.6, 1.0, vEdge));
  a *= uOpacity;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/** 가장자리가 살짝 우는 스플래시용 고리 (반지름 1 기준) */
function buildSplashRing(seed: number): BufferGeometry {
  const segments = 48;
  const pos: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const w = 1 + 0.12 * Math.sin(a * 5 + seed) * Math.cos(a * 3 - seed);
    pos.push(Math.cos(a) * 0.55 * w, 0, Math.sin(a) * 0.55 * w);
    edge.push(0);
    pos.push(Math.cos(a) * w, 0, Math.sin(a) * w);
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

interface Splash {
  mesh: Mesh;
  material: ShaderMaterial;
  x: number;
  z: number;
  size: number;
  t: number;
  active: boolean;
}

const SPLASH_MAX = 12;
const SPLASH_DUR = 0.85;

/** 물체가 물 밖으로 튀어나오는 이징 — 끝에서 살짝 넘쳤다 돌아온다 */
function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

export class Voyage {
  /** 소품·스플래시가 담기는 그룹 — 월드 좌표 (배 기준 상대 위치로 매 프레임 갱신) */
  readonly group = new Group();

  active = false;
  /** 배가 바다 위 어디에 있는가 — 바다 스크롤 오프셋이기도 하다 */
  seaX = 0;
  seaZ = 0;
  vx = 0;
  vz = 0;
  /** 부품 효과(엔진·돛·외륜)로 붙는 속도 보너스 */
  speedBonus = 0;

  private props: Prop[] = [];
  private readonly splashes: Splash[] = [];
  private readonly splashGeo: BufferGeometry;
  private readonly rock: FlatMaterial;
  private readonly rockDark: FlatMaterial;
  private readonly rockMoss: FlatMaterial;
  private readonly collar: FlatMaterial;
  private readonly buoyBody: FlatMaterial;
  private readonly buoyBand: FlatMaterial;
  private readonly buoyLamp: FlatMaterial;
  private readonly wood: FlatMaterial;
  private readonly sand: FlatMaterial;

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
    this.buoyBody = flat('coral');
    this.buoyBand = flat('cream');
    this.buoyLamp = flat('sun');
    this.wood = flat('timber');
    this.sand = flat('sun');

    this.group.name = 'voyage-props';

    // 스플래시 풀 — 미리 만들어 두고 돌려 쓴다. 항해 중 매번 지오메트리를 만들지 않는다
    this.splashGeo = buildSplashRing(2.3);
    for (let i = 0; i < SPLASH_MAX; i++) {
      const material = new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(int(FX_COLORS.foamBright)) },
          uOpacity: { value: 0 },
        },
        vertexShader: SPLASH_VERT,
        fragmentShader: SPLASH_FRAG,
        transparent: true,
        depthWrite: false,
        // 생성 지오메트리 + 커스텀 셰이더 = 와인딩에 따라 통째로 사라진다 (§4.2)
        side: DoubleSide,
      });
      const mesh = new Mesh(this.splashGeo, material);
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.group.add(mesh);
      this.splashes.push({ mesh, material, x: 0, z: 0, size: 1, t: 0, active: false });
    }

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
    for (const prop of this.props) for (const g of prop.geos) g.dispose();
    for (const s of this.splashes) s.material.dispose();
    this.splashGeo.dispose();
    this.rock.dispose();
    this.rockDark.dispose();
    this.rockMoss.dispose();
    this.collar.dispose();
    this.buoyBody.dispose();
    this.buoyBand.dispose();
    this.buoyLamp.dispose();
    this.wood.dispose();
    this.sand.dispose();
  }

  onHit(fn: () => void): () => void {
    this.hitListeners.add(fn);
    return () => this.hitListeners.delete(fn);
  }

  /** 지금 물살을 가르는 속도 (유닛/초) — 항해 UI 의 속도계가 읽는다 */
  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.keys.clear();
    this.stickX = 0;
    this.stickZ = 0;
    this.pointerId = null;
    if (active) {
      // 출항 — 소품들이 물속에서 솟아오른다. 첫 항해든 재출항이든 똑같이.
      if (this.props.length === 0) this.seedProps();
    } else {
      this.vx = 0;
      this.vz = 0;
      // 정박 — 소품들이 차례로 가라앉아 사라진다. 바다는 다시 빈 수평선으로.
      // (가라앉는 애니메이션은 active 가 꺼진 뒤에도 update 가 계속 굴린다)
      this.props.forEach((prop, i) => this.startSink(prop, i * SINK_STAGGER));
    }
    // 바다 위치(seaX/seaZ)는 남긴다 — 다음 항해는 정박한 자리에서 이어진다.
  }

  /**
   * 첫 출항의 소품들 — 암초 하나는 **반드시 정면**에 둔다.
   * 전부 난수에 맡기면 "암초라더니 아무것도 없는데?" 로 끝나는 첫 항해가 나온다.
   * 풍경(부표·유목)도 하나씩 심어 "장애물 코스"가 아니라 "바다"로 시작하게 한다.
   */
  private seedProps(): void {
    this.addProp('reef', this.seaX + 3, this.seaZ - 27, 1.5);
    this.addProp('reef', this.seaX - 16, this.seaZ - 48, 1.2);
    this.addProp('spire', this.seaX + 22, this.seaZ - 60, 1.6);
    this.addProp('buoy', this.seaX - 7, this.seaZ - 18, 0.6);
    this.addProp('drift', this.seaX + 10, this.seaZ - 36, 0.8);
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

      // --- 소품 보충 — 달릴수록 풍경이 잦아진다 (지나가는 맛) ---
      this.spawnTimer -= dt * (1 + this.speed * 0.18);
      if (this.props.length < PROP_MAX && this.spawnTimer <= 0) {
        this.spawnAhead();
        this.spawnTimer = 1.4 + Math.random() * 1.8;
      }
    }

    // --- 소품 배치·연출·정리·충돌 (정박 중에도 가라앉기는 계속 굴린다) ---
    for (let i = this.props.length - 1; i >= 0; i--) {
      const prop = this.props[i]!;
      const dx = prop.x - this.seaX;
      const dz = prop.z - this.seaZ;
      const dist = Math.hypot(dx, dz);

      // 화면 밖 멀리 벗어난 소품은 연출 없이 치운다 — 보이지도 않는 연출은 낭비다
      if (dist > CULL_DIST) {
        this.removeProp(i);
        continue;
      }

      // 등장/퇴장 연출
      let dip = 0;
      let pop = 1;
      if (prop.anim === 'rise') {
        prop.t = Math.min(1, prop.t + dt / RISE_DUR);
        const k = easeOutBack(prop.t);
        dip = -prop.depth * (1 - k);
        pop = 0.6 + 0.4 * k;
        if (prop.t >= 1) prop.anim = 'idle';
      } else if (prop.anim === 'sink') {
        prop.delay -= dt;
        if (prop.delay <= 0) {
          if (!prop.splashed) {
            prop.splashed = true;
            this.splash(prop.x, prop.z, 0.8 + prop.r * 0.8);
          }
          prop.t = Math.min(1, prop.t + dt / SINK_DUR);
          const k = prop.t * prop.t * prop.t;
          dip = -prop.depth * k;
          pop = 1 - 0.2 * prop.t;
          if (prop.t >= 1) {
            this.removeProp(i);
            continue;
          }
        }
      }

      // 부표·유목은 물결에 얹혀 오르내린다. 바위는 뿌리가 바다 밑까지 닿아 있다
      let baseY = 0;
      if (prop.floats) {
        const wave = sampleWave(prop.x, prop.z, elapsed);
        baseY = wave.height;
        prop.mesh.rotation.z = wave.slopeX * 0.5 + Math.sin(elapsed * 1.3 + prop.sway) * 0.1;
        prop.mesh.rotation.x = wave.slopeZ * 0.5;
      }
      prop.mesh.position.set(dx, baseY + dip, dz);
      prop.mesh.scale.setScalar(pop);

      if (
        this.active &&
        prop.collide &&
        prop.anim === 'idle' &&
        dist < prop.r + BOAT_RADIUS &&
        elapsed - this.lastHit > HIT_COOLDOWN &&
        dist > 1e-3
      ) {
        this.lastHit = elapsed;
        // 암초 반대쪽으로 튕겨 나간다. 벌점은 없다 — 따개비가 붙을 뿐이다(main.ts)
        const nx = -dx / dist;
        const nz = -dz / dist;
        this.vx = nx * KNOCKBACK;
        this.vz = nz * KNOCKBACK;
        // 부딪힌 뱃전 자리에 물보라 — 소리 없는 게임에서 이게 "쿵"이다
        this.splash(this.seaX + (dx / dist) * BOAT_RADIUS, this.seaZ + (dz / dist) * BOAT_RADIUS, 1.5);
        for (const fn of this.hitListeners) fn();
      }
    }

    // --- 스플래시 링 — 퍼지며 사라진다 ---
    for (const s of this.splashes) {
      if (!s.active) continue;
      s.t += dt / SPLASH_DUR;
      if (s.t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const spread = s.size * (0.4 + s.t * 1.6);
      s.mesh.scale.set(spread, 1, spread);
      s.material.uniforms.uOpacity!.value = (1 - s.t) ** 1.6 * 0.95;
      const y = sampleWave(s.x, s.z, elapsed).height + 0.05;
      s.mesh.position.set(s.x - this.seaX, y, s.z - this.seaZ);
    }
  }

  /** 진행 방향 앞쪽 부챗살 안 어딘가에 소품 하나 */
  private spawnAhead(): void {
    const speed = this.speed;
    // 서 있으면 수평선 쪽(-z)이 "앞"이다
    const dirX = speed > 0.5 ? this.vx / speed : 0;
    const dirZ = speed > 0.5 ? this.vz / speed : -1;

    const kind = this.pickKind();
    // 풍경은 더 옆으로 벌려 심는다 — 정면에 서 있는 부표는 과녁이지 풍경이 아니다
    const spreadMax = kind === 'buoy' || kind === 'drift' ? 2.3 : 1.7;
    const spread = (Math.random() - 0.5) * spreadMax;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const ax = dirX * cos - dirZ * sin;
    const az = dirX * sin + dirZ * cos;

    const dist = SPAWN_NEAR + Math.random() * (SPAWN_FAR - SPAWN_NEAR);
    const r =
      kind === 'islet' ? 2.4 + Math.random() * 1.0
      : kind === 'spire' ? 1.1 + Math.random() * 0.8
      : kind === 'buoy' ? 0.6
      : kind === 'drift' ? 0.7 + Math.random() * 0.4
      : 1 + Math.random() * 1.1;
    this.addProp(kind, this.seaX + ax * dist, this.seaZ + az * dist, r);
  }

  private pickKind(): PropKind {
    const collides = this.props.filter((p) => p.collide).length;
    for (let guard = 0; guard < 8; guard++) {
      let roll = Math.random();
      for (const { kind, weight } of PROP_WEIGHTS) {
        roll -= weight;
        if (roll > 0) continue;
        const isCollider = kind === 'reef' || kind === 'spire' || kind === 'islet';
        if (isCollider && collides >= COLLIDE_MAX) break; // 다시 굴린다
        return kind;
      }
    }
    return 'drift';
  }

  private addProp(kind: PropKind, x: number, z: number, r: number): void {
    const geos: BufferGeometry[] = [];
    const keep = (geo: BufferGeometry): BufferGeometry => {
      geos.push(geo);
      return geo;
    };
    const mesh =
      kind === 'reef' ? this.buildReef(r, keep)
      : kind === 'spire' ? this.buildSpire(r, keep)
      : kind === 'islet' ? this.buildIslet(r, keep)
      : kind === 'buoy' ? this.buildBuoy(keep)
      : this.buildDrift(r, keep);

    const collide = kind === 'reef' || kind === 'spire' || kind === 'islet';
    const floats = kind === 'buoy' || kind === 'drift';
    const depth = kind === 'spire' ? r * 3.2 : kind === 'buoy' ? 2 : r * 2 + 0.8;

    mesh.position.set(x - this.seaX, -depth, z - this.seaZ);
    this.group.add(mesh);
    this.props.push({
      kind, x, z, r, collide, floats, depth, mesh, geos,
      anim: 'rise', t: 0, delay: 0, splashed: true,
      sway: Math.random() * Math.PI * 2,
    });
    // 솟아오르는 자리에 포말이 먼저 퍼진다 — "무언가 올라온다"는 예고
    this.splash(x, z, 0.7 + r * 0.7);
  }

  private startSink(prop: Prop, delay: number): void {
    if (prop.anim === 'sink') return;
    prop.anim = 'sink';
    prop.t = 0;
    prop.delay = delay;
    prop.splashed = false;
  }

  private removeProp(index: number): void {
    const prop = this.props[index]!;
    this.group.remove(prop.mesh);
    for (const g of prop.geos) g.dispose();
    this.props.splice(index, 1);
  }

  /** 스플래시 풀에서 한 자리 빌려 물보라를 터뜨린다 */
  private splash(x: number, z: number, size: number): void {
    const slot = this.splashes.find((s) => !s.active) ?? this.splashes[0]!;
    slot.active = true;
    slot.t = 0;
    slot.x = x;
    slot.z = z;
    slot.size = size;
    slot.mesh.visible = true;
    slot.mesh.scale.set(size * 0.4, 1, size * 0.4);
    slot.material.uniforms.uOpacity!.value = 0;
  }

  // --- 소품 3D 모델 — 전부 팔레트 flat(), 텍스처 없음 ---

  /** 로우폴리 바위 — 큰 덩이 + 곁돌 + 이끼 모자 + 물때 띠 */
  private buildReef(r: number, keep: (g: BufferGeometry) => BufferGeometry): Group {
    const group = new Group();

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

  /** 바위기둥 — 좁고 높게 쌓인 돌탑. 멀리서도 실루엣이 서 있다 */
  private buildSpire(r: number, keep: (g: BufferGeometry) => BufferGeometry): Group {
    const group = new Group();

    const base = new Mesh(keep(new OctahedronGeometry(r * 0.9, 0)), this.rockDark);
    base.scale.y = 1.6;
    base.position.y = r * 0.5 - 0.4;
    base.rotation.y = Math.random() * Math.PI;

    const shaft = new Mesh(keep(new OctahedronGeometry(r * 0.62, 0)), this.rock);
    shaft.scale.y = 2.6;
    shaft.position.y = r * 1.9;
    shaft.rotation.y = Math.random() * Math.PI;

    const tip = new Mesh(keep(new OctahedronGeometry(r * 0.3, 0)), this.rockMoss);
    tip.position.y = r * 3.3;

    const ring = new Mesh(keep(new OctahedronGeometry(r * 1.0, 0)), this.collar);
    ring.scale.y = 0.1;
    ring.position.y = 0.02;
    ring.rotation.y = Math.random() * Math.PI;

    group.add(base, shaft, tip, ring);
    return group;
  }

  /** 모래섬 — 낮고 넓은 바위 무리 + 모랫빛 물가. 지나치는 이정표 */
  private buildIslet(r: number, keep: (g: BufferGeometry) => BufferGeometry): Group {
    const group = new Group();

    const mound = new Mesh(keep(new OctahedronGeometry(r, 0)), this.rock);
    mound.scale.y = 0.7;
    mound.position.y = r * 0.12 - 0.3;
    mound.rotation.y = Math.random() * Math.PI;

    const left = new Mesh(keep(new OctahedronGeometry(r * 0.5, 0)), this.rockDark);
    left.scale.y = 0.9;
    left.position.set(-r * 0.8, r * 0.05 - 0.3, r * 0.3);
    left.rotation.y = Math.random() * Math.PI;

    const mossA = new Mesh(keep(new OctahedronGeometry(r * 0.34, 0)), this.rockMoss);
    mossA.position.set(r * 0.15, r * 0.62, -r * 0.1);
    const mossB = new Mesh(keep(new OctahedronGeometry(r * 0.22, 0)), this.rockMoss);
    mossB.position.set(-r * 0.55, r * 0.32, r * 0.28);

    // 물가의 모랫빛 테 — 섬은 바위와 물 사이에 밝은 살이 있어야 섬으로 읽힌다
    const shore = new Mesh(keep(new OctahedronGeometry(r * 1.3, 0)), this.sand);
    shore.scale.y = 0.08;
    shore.position.y = 0.03;
    shore.rotation.y = Math.random() * Math.PI;

    const ring = new Mesh(keep(new OctahedronGeometry(r * 1.5, 0)), this.collar);
    ring.scale.y = 0.06;
    ring.position.y = 0.01;
    ring.rotation.y = Math.random() * Math.PI;

    group.add(mound, left, mossA, mossB, shore, ring);
    return group;
  }

  /** 항로 부표 — 산호빛 몸통 + 크림 띠 + 꼭대기 등. 물결에 얹혀 갸웃거린다 */
  private buildBuoy(keep: (g: BufferGeometry) => BufferGeometry): Group {
    const group = new Group();

    const body = new Mesh(keep(new CylinderGeometry(0.26, 0.42, 0.85, 7, 1)), this.buoyBody);
    body.position.y = 0.28;

    const band = new Mesh(keep(new CylinderGeometry(0.365, 0.395, 0.2, 7, 1)), this.buoyBand);
    band.position.y = 0.16;

    const neck = new Mesh(keep(new CylinderGeometry(0.06, 0.06, 0.5, 5, 1)), this.buoyBand);
    neck.position.y = 0.9;

    const lamp = new Mesh(keep(new OctahedronGeometry(0.15, 0)), this.buoyLamp);
    lamp.position.y = 1.2;

    group.add(body, band, neck, lamp);
    return group;
  }

  /** 유목 — 물결에 실려 떠다니는 통나무. 가지 밑동 하나가 붙어 있다 */
  private buildDrift(r: number, keep: (g: BufferGeometry) => BufferGeometry): Group {
    const group = new Group();
    const len = r * 2.6;

    const log = new Mesh(keep(new CylinderGeometry(r * 0.22, r * 0.28, len, 6, 1)), this.wood);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = Math.random() * Math.PI;
    log.position.y = 0.05;

    const stub = new Mesh(keep(new CylinderGeometry(r * 0.08, r * 0.11, r * 0.5, 5, 1)), this.rockDark);
    stub.position.set(len * 0.2, r * 0.25, 0);
    stub.rotation.z = -0.5;
    stub.rotation.y = log.rotation.y;

    group.add(log, stub);
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
