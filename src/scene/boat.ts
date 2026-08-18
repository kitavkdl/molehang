import { CylinderGeometry, Group, Mesh, Object3D, Vector3, type BufferGeometry } from 'three';
import {
  PART_INFO,
  PART_KINDS,
  PART_ZONES,
  emptyInventory,
  type Inventory,
} from '../game/parts.ts';
import { BOAT_COLORS, type PaletteKey } from '../style/palette.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import {
  BOAT_YAW,
  HULL,
  boxGeometry,
  buildHull,
  flagGeometry,
  sailGeometry,
  type HullSpec,
} from './hull.ts';
import type { ArrangeTarget } from './arrange.ts';
import { sampleWave } from './ocean.ts';
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

    const mastHeight = 3.7;
    const mast = add(new CylinderGeometry(0.055, 0.085, mastHeight, 6, 1), BOAT_COLORS.mast, 'mast');
    mast.position.set(0, spec.freeboard + mastHeight / 2 - 0.14, 0.5);

    const sailY = spec.freeboard + 0.3;
    const sail = add(sailGeometry(3.0, 2.75, 0.56), BOAT_COLORS.sail, 'sail');
    sail.position.set(0, sailY, 0.45);

    // 같은 곡면의 u 구간을 잘라 만든 가로 띠.
    // 돛보다 현(chord)을 길게 잡아 뒷변이 돛 밖으로 살짝 나가야
    // 가운데만 뜨는 '얼룩'이 아니라 꿰맨 띠처럼 보인다.
    const stripe = add(sailGeometry(3.0, 2.94, 0.585, 0.44, 0.58), BOAT_COLORS.sailStripe, 'stripe');
    stripe.position.set(0, sailY, 0.45);

    const flag = add(flagGeometry(0.62), BOAT_COLORS.rail, 'flag');
    flag.position.set(0, spec.freeboard + mastHeight - 0.74, 0.5);

    // 수거한 자원이 빨려 들어가는 나무 상자
    this.crate = add(boxGeometry(0.86, 0.64, 0.8), BOAT_COLORS.crate, 'crate');
    this.crate.position.set(0, spec.freeboard + 0.32, -1.6);

    const trim = add(boxGeometry(0.93, 0.12, 0.87), BOAT_COLORS.crateTrim, 'crate-trim');
    trim.position.set(0, spec.freeboard + 0.64, -1.6);

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
  }

  /** 배치 모드에서 끌 수 있는 부품들 */
  get arrangeTargets(): ArrangeTarget[] {
    return this.parts;
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
  }
}
