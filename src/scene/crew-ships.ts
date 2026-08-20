import { CylinderGeometry, Group, Mesh, type BufferGeometry } from 'three';
import type { AvatarOutfit } from '../game/avatar.ts';
import { BOAT_COLORS, type PaletteKey } from '../style/palette.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { BOAT_YAW, FITTINGS, HULL, buildHull, sailGeometry } from './hull.ts';
import { sampleWave } from './ocean.ts';

/**
 * 동행선 — 같이 접속해 있는 선원들의 배가 내 바다에도 떠 있다. (CLAUDE.md §4.3)
 *
 * 갑판 아바타(avatars.ts)가 "쟤가 내 배에 타 있다"라면, 이건 "쟤 배가 저기 같이 간다"다.
 * 화면을 볼 때마다 혼자가 아니라는 게 **풍경으로** 보이는 것이 목적이라,
 * 선원이 떠나면(하트비트 끊김) 배도 가라앉아 사라진다 — 같이 있는 동안만이 원칙이다.
 *
 * 돛 줄무늬가 그 선원의 아바타 옷 색이다. 옷 색 id 는 팔레트 키라 새 색이 생길 길은 없다.
 *
 * 규칙 세 가지 (되돌리지 말 것):
 *  - **풍경이다.** 충돌하지 않고, 부품이 아니며, 자리를 안 먹는다. §4.9 의
 *    "풍경을 충돌체로 바꾸지 말 것"과 같은 이유 — 바다가 장애물 코스가 되면 안 된다.
 *  - **갑자기 나타나거나 사라지지 않는다.** 물속에서 솟아오르고, 가라앉으며 나간다. §4.9.
 *  - 배는 원점, 바다가 흐른다(§4.9). 동행선은 배 기준 고정 자리에 떠 있고 파도만
 *    바다 좌표(seaX+x, seaZ+z)로 샘플링한다 — 그래서 항해 중엔 저절로 "나란히 달린다".
 */

/** 동행선이 서는 자리 (배 기준 x, z) — CREW_MAX-1 척. 수평선 쪽(-z)에 흩어 둔다 */
const BERTHS: ReadonlyArray<{ x: number; z: number; yaw: number; bob: number }> = [
  { x: -4.6, z: -19, yaw: 0.35, bob: 0 },
  { x: 5.4, z: -30, yaw: -0.3, bob: 2.1 },
  { x: -7.2, z: -44, yaw: 0.15, bob: 4.4 },
];

/** 멀리서 보는 배라 절반 크기 — 원근과 합쳐져 "저 멀리 한 척"으로 읽힌다 */
const SCALE = 0.52;
/** 등장/퇴장 잠수 깊이와 시간 */
const DIVE_Y = -1.9;
const RISE_SEC = 1.4;
const SINK_SEC = 1.1;

interface Escort {
  id: string;
  group: Group;
  stripe: Mesh;
  berth: (typeof BERTHS)[number];
  /** 0(물속) → 1(수면) */
  t: number;
  sinking: boolean;
}

export class CrewShips {
  readonly group = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials = new Map<PaletteKey, FlatMaterial>();
  private readonly parts: { geo: BufferGeometry; key: PaletteKey; y?: number; z?: number }[];
  private readonly sailGeo: BufferGeometry;
  private readonly stripeGeo: BufferGeometry;
  private escorts: Escort[] = [];

  constructor() {
    this.group.name = 'crew-ships';

    // 지오메트리는 한 번만 만들어 모든 동행선이 공유한다
    const hull = buildHull(HULL);
    const { mast: M, sail: S, stripe: T } = FITTINGS;
    const mastGeo = this.keep(new CylinderGeometry(M.top, M.bottom, M.height, 6, 1));
    this.sailGeo = this.keep(sailGeometry(S.height, S.chord, S.bulge));
    this.stripeGeo = this.keep(sailGeometry(S.height, T.chord, T.bulge, T.u0, T.u1));

    this.parts = [
      { geo: this.keep(hull.hull), key: BOAT_COLORS.hull },
      { geo: this.keep(hull.deck), key: BOAT_COLORS.deck },
      { geo: this.keep(hull.rail), key: BOAT_COLORS.rail },
      { geo: mastGeo, key: BOAT_COLORS.mast, y: HULL.freeboard + M.height / 2 - M.drop, z: M.z },
      { geo: this.sailGeo, key: BOAT_COLORS.sail, y: HULL.freeboard + S.rise, z: S.z },
    ];
  }

  /** 접속 중인 선원들 — 새로 온 사람은 솟아오르고, 떠난 사람은 가라앉는다 */
  setCrew(members: ReadonlyArray<{ id: string; outfit: AvatarOutfit }>): void {
    const roster = members.slice(0, BERTHS.length);
    const wanted = new Map(roster.map((m) => [m.id, m]));

    // 떠난 선원 — 가라앉기 시작 (이미 가라앉는 중이면 그대로)
    for (const escort of this.escorts) {
      if (!wanted.has(escort.id)) escort.sinking = true;
    }

    for (const member of roster) {
      const existing = this.escorts.find((e) => e.id === member.id);
      if (existing !== undefined) {
        // 돌아왔거나(가라앉다 복귀) 옷을 갈아입었다
        existing.sinking = false;
        const mat = this.material(member.outfit);
        if (existing.stripe.material !== mat) existing.stripe.material = mat;
        continue;
      }
      const used = new Set(this.escorts.map((e) => e.berth));
      const berth = BERTHS.find((b) => !used.has(b)) ?? BERTHS[0]!;
      this.escorts.push(this.spawn(member.id, member.outfit, berth));
    }
  }

  update(elapsed: number, dt: number, seaX: number, seaZ: number, heading: number): void {
    for (let i = this.escorts.length - 1; i >= 0; i--) {
      const escort = this.escorts[i]!;
      const b = escort.berth;

      escort.t += escort.sinking ? -dt / SINK_SEC : dt / RISE_SEC;
      escort.t = Math.min(1, Math.max(0, escort.t));
      if (escort.sinking && escort.t <= 0) {
        this.group.remove(escort.group);
        this.escorts.splice(i, 1);
        continue;
      }

      // 부드럽게 솟아오르고 가라앉는다 — 갑자기 나타나는 소품은 없다 (§4.9)
      const ease = escort.t * escort.t * (3 - 2 * escort.t);
      const wave = sampleWave(seaX + b.x, seaZ + b.z, elapsed).height;
      escort.group.position.set(b.x, wave + DIVE_Y * (1 - ease), b.z);
      // 항해 중엔 내 뱃머리를 따라 돈다 — 나란히 달리는 함대처럼 읽힌다.
      // 정박 구도(heading = BOAT_YAW)에서는 각자 조금씩 다른 곳을 본다.
      escort.group.rotation.y = heading - BOAT_YAW + b.yaw + BOAT_YAW * 0.8;
      escort.group.rotation.z = Math.sin(elapsed * 0.7 + b.bob) * 0.045;
      escort.group.rotation.x = Math.sin(elapsed * 0.55 + b.bob * 1.7) * 0.03;
    }
  }

  private spawn(id: string, outfit: AvatarOutfit, berth: (typeof BERTHS)[number]): Escort {
    const g = new Group();
    g.scale.setScalar(SCALE);

    for (const part of this.parts) {
      const mesh = new Mesh(part.geo, this.material(part.key));
      if (part.y !== undefined) mesh.position.y = part.y;
      if (part.z !== undefined) mesh.position.z = part.z;
      g.add(mesh);
    }

    // 줄무늬만 그 선원의 옷 색 — 갑판에 서 있는 아바타와 같은 색이라 누군지 읽힌다
    const { sail: S } = FITTINGS;
    const stripe = new Mesh(this.stripeGeo, this.material(outfit));
    stripe.position.set(0, HULL.freeboard + S.rise, S.z);
    g.add(stripe);

    g.position.set(berth.x, DIVE_Y, berth.z);
    this.group.add(g);
    return { id, group: g, stripe, berth, t: 0, sinking: false };
  }

  private material(key: PaletteKey): FlatMaterial {
    let m = this.materials.get(key);
    if (m === undefined) {
      m = flat(key);
      this.materials.set(key, m);
    }
    return m;
  }

  private keep<T extends BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}
