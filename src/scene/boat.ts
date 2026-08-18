import { CylinderGeometry, Group, Mesh, Object3D, Vector3, type BufferGeometry } from 'three';
import {
  PART_INFO,
  PART_KINDS,
  PART_ZONES,
  emptyInventory,
  type Inventory,
} from '../game/parts.ts';
import { ARRANGE_COLORS, BOAT_COLORS, type PaletteKey } from '../style/palette.ts';
import { flat, flatUnlit, type FlatMaterial } from './flat-material.ts';
import {
  BOAT_YAW,
  FITTINGS,
  HULL,
  boxGeometry,
  buildHull,
  flagGeometry,
  sailGeometry,
  type HullSpec,
} from './hull.ts';
import type { ArrangeTarget } from './arrange.ts';
import { sampleWave } from './ocean.ts';
import { buildPartOutline, disposePartOutlines } from './part-outline.ts';
import { buildPart, partKey } from './part-sockets.ts';

export { BOAT_YAW, HULL } from './hull.ts';

/**
 * 배 = 고정된 선체 + 인벤토리에서 생성되는 파츠들.
 *
 * `setParts()` 는 같은 인벤토리를 다시 받으면 아무것도 안 한다.
 * 새 파츠가 붙을 때는 그 파츠만 팝 애니메이션으로 등장한다.
 */
export class Boat {
  readonly group = new Group();
  /** 배 전체를 감싸는 안쪽 그룹 — 바운스 스케일은 여기에만 준다 */
  private readonly body = new Group();
  /** 파츠만 담는 그룹 */
  private readonly rig = new Group();
  private readonly crate: Mesh;
  private readonly materials: FlatMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];

  private mounted: Object3D[] = [];
  private parts: ArrangeTarget[] = [];
  private previous: Inventory = emptyInventory();
  private placements: Record<string, [number, number, number]> = {};
  private signature = '';
  /** 부품 키 → 그 부품을 감싸는 테두리 */
  private readonly outlines = new Map<string, Mesh>();
  private outlineIdle: FlatMaterial;
  private outlinePicked: FlatMaterial;
  private arrangeMode = false;
  private pickedKey: string | null = null;
  /** 방금 붙어서 튀어 오르는 중인 파츠들 */
  private readonly popping: Array<{ object: Object3D; t: number; scale: number }> = [];

  private bounceT = Infinity;
  private readonly crateWorld = new Vector3();

  constructor(spec: HullSpec = HULL) {
    const { hull, deck, rail, keel } = buildHull(spec);

    const add = (geo: BufferGeometry, key: PaletteKey, name: string): Mesh => {
      // 전부 단색 flat shading. 텍스처·PBR 금지. (CLAUDE.md §3.2)
      const material = flat(key);
      const mesh = new Mesh(geo, material);
      mesh.name = name;
      this.materials.push(material);
      this.geometries.push(geo);
      this.body.add(mesh);
      return mesh;
    };

    add(hull, BOAT_COLORS.hull, 'hull');
    add(keel, BOAT_COLORS.hullTrim, 'keel');
    add(deck, BOAT_COLORS.deck, 'deck');
    add(rail, BOAT_COLORS.rail, 'rail');

    // 치수는 전부 hull.ts 의 FITTINGS 에서 온다 — 부품이 무엇에 닿는지 계산하는
    // part-support.ts 가 같은 숫자를 봐야 하기 때문이다.
    const { mast: M, sail: S, stripe: T, flag: F, crate: C, crateTrim: CT } = FITTINGS;

    const mast = add(
      new CylinderGeometry(M.top, M.bottom, M.height, 6, 1),
      BOAT_COLORS.mast,
      'mast',
    );
    mast.position.set(0, spec.freeboard + M.height / 2 - M.drop, M.z);

    const sailY = spec.freeboard + S.rise;
    const sail = add(sailGeometry(S.height, S.chord, S.bulge), BOAT_COLORS.sail, 'sail');
    sail.position.set(0, sailY, S.z);

    // 같은 곡면의 u 구간을 잘라 만든 가로 띠.
    // 돛보다 현(chord)을 길게 잡아 뒷변이 돛 밖으로 살짝 나가야
    // 가운데만 뜨는 '얼룩'이 아니라 꿰맨 띠처럼 보인다.
    const stripe = add(
      sailGeometry(S.height, T.chord, T.bulge, T.u0, T.u1),
      BOAT_COLORS.sailStripe,
      'stripe',
    );
    stripe.position.set(0, sailY, S.z);

    const flag = add(flagGeometry(F.size), BOAT_COLORS.rail, 'flag');
    flag.position.set(0, spec.freeboard + M.height - F.drop, M.z);

    // 수거한 자원이 빨려 들어가는 나무 상자
    this.crate = add(boxGeometry(C.width, C.height, C.depth), BOAT_COLORS.crate, 'crate');
    this.crate.position.set(0, spec.freeboard + C.rise, C.z);

    const trim = add(
      boxGeometry(CT.width, CT.height, CT.depth),
      BOAT_COLORS.crateTrim,
      'crate-trim',
    );
    trim.position.set(0, spec.freeboard + CT.rise, C.z);

    // 배치 모드 테두리 — 조명을 안 받는다. 밤이면 배는 어둠에 잠기는 게 맞지만
    // "이건 옮길 수 있다"는 표식까지 잠기면 조작이 보이지 않는다.
    this.outlineIdle = flatUnlit(ARRANGE_COLORS.edge);
    this.outlinePicked = flatUnlit(ARRANGE_COLORS.picked);
    this.materials.push(this.outlineIdle, this.outlinePicked);

    this.body.add(this.rig);
    this.body.rotation.y = BOAT_YAW;
    this.group.add(this.body);
    this.group.name = 'boat';
  }

  /**
   * 인벤토리를 배에 반영한다.
   *
   * 자리 번호는 **구역 단위**로 매겨진다 — 같은 갑판을 굴뚝과 대포가 나눠 쓰므로
   * 종류별로 세면 서로 겹친다. 그래서 구성이 바뀌면 그 구역을 다시 깐다.
   *
   * @param animateNew 새로 붙는 파츠를 팝 애니메이션으로 등장시킬지
   */
  setParts(
    inventory: Inventory,
    animateNew = false,
    placements: Record<string, [number, number, number]> = this.placements,
  ): void {
    const signature = `${PART_KINDS.map((k) => inventory[k]).join(',')}|${JSON.stringify(placements)}`;
    if (signature === this.signature) return;

    for (const obj of this.mounted) this.rig.remove(obj);
    this.mounted = [];
    this.parts = [];
    this.outlines.clear();
    this.popping.length = 0;
    this.placements = placements;

    for (const zone of PART_ZONES) {
      let index = 0;
      for (const kind of PART_KINDS) {
        if (PART_INFO[kind].zone !== zone) continue;
        for (let i = 0; i < inventory[kind]; i++) {
          const object = buildPart(kind, index);
          index += 1;

          // 끌어서 옮겨 둔 자리가 있으면 그걸 쓴다
          const key = partKey(kind, i);
          const custom = placements[key];
          if (custom !== undefined) object.position.set(custom[0], custom[1], custom[2]);

          // 테두리는 부품의 **자식**이다 — 끌어 옮기면 알아서 따라간다
          const outline = buildPartOutline(kind, this.outlineIdle);
          object.add(outline);
          this.outlines.set(key, outline);

          this.rig.add(object);
          this.mounted.push(object);
          this.parts.push({ object, key, zone });

          // 이번에 늘어난 개수만 팝으로 등장시킨다
          if (animateNew && i >= this.previous[kind]) {
            this.popping.push({ object, t: 0, scale: object.scale.x });
            object.scale.setScalar(0.01);
          }
        }
      }
    }

    this.previous = { ...inventory };
    this.signature = signature;
    // 배치 중에 부품이 다시 깔릴 수 있다(자리를 저장한 직후 등) — 표식 상태를 다시 입힌다
    this.applyOutlines();
  }

  /** 배치 모드에서 끌 수 있는 부품들 */
  get arrangeTargets(): ArrangeTarget[] {
    return this.parts;
  }

  /**
   * 배치 모드 표식 켜기/끄기.
   * 켜면 옮길 수 있는 부품 **전부**에 테두리가 뜬다 — 무엇이 대상인지 화면만 보고 알게.
   */
  setArrangeMode(active: boolean): void {
    this.arrangeMode = active;
    if (!active) this.pickedKey = null;
    this.applyOutlines();
  }

  /** 지금 집고 있는 부품 하나만 색을 바꾼다 */
  setPickedPart(key: string | null): void {
    this.pickedKey = key;
    this.applyOutlines();
  }

  private applyOutlines(): void {
    for (const [key, mesh] of this.outlines) {
      mesh.visible = this.arrangeMode;
      mesh.material = key === this.pickedKey ? this.outlinePicked : this.outlineIdle;
      if (!this.arrangeMode) mesh.scale.setScalar(1);
    }
  }

  /** 배 로컬 좌표계의 기준 — 드래그 좌표 변환에 쓴다 */
  get localSpace(): Group {
    return this.body;
  }

  /** 파도 위에서 흔들린다 — 바다 셰이더와 같은 파형 함수를 공유 */
  update(elapsed: number, dt: number): void {
    const { height, slopeX, slopeZ } = sampleWave(0, 0, elapsed);

    let bounceScale = 1;
    let bounceLift = 0;
    if (this.bounceT < 1.2) {
      this.bounceT += dt;
      const t = this.bounceT;
      const decay = Math.exp(-5.2 * t);
      bounceScale = 1 + 0.11 * decay * Math.sin(t * 17);
      bounceLift = 0.14 * decay * Math.sin(t * 13);
    }

    this.group.position.y = height + bounceLift;
    this.group.rotation.z = -slopeX * 0.55;
    this.group.rotation.x = slopeZ * 0.55;
    this.body.scale.setScalar(bounceScale);

    // 새로 붙은 파츠 팝
    for (let i = this.popping.length - 1; i >= 0; i--) {
      const p = this.popping[i]!;
      p.t += dt;
      const k = Math.min(1, p.t / 0.42);
      // 살짝 오버슈트하는 이징
      const e = 1 + 2.7 * (1 - k) ** 3 * Math.sin(k * 9.4);
      p.object.scale.setScalar(p.scale * (k >= 1 ? 1 : k * e));
      if (k >= 1) {
        p.object.scale.setScalar(p.scale);
        this.popping.splice(i, 1);
      }
    }

    // 배치 표식은 천천히 숨을 쉰다 — 멈춰 있는 테두리보다 훨씬 먼저 눈에 띈다
    if (this.arrangeMode) {
      const pulse = 1 + 0.06 * Math.sin(elapsed * 4.4);
      for (const [key, mesh] of this.outlines) {
        mesh.scale.setScalar(key === this.pickedKey ? pulse + 0.09 : pulse);
      }
    }

    this.crate.getWorldPosition(this.crateWorld);
  }

  /** 수거 시 가벼운 스케일 바운스 */
  bounce(): void {
    this.bounceT = 0;
  }

  /** 파티클이 빨려 들어갈 목표점 */
  get collectTarget(): Vector3 {
    return this.crateWorld;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    disposePartOutlines();
  }
}
