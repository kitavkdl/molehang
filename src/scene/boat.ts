import { CylinderGeometry, Group, Mesh, Object3D, Vector3, type BufferGeometry } from 'three';
import { PART_KINDS, type Inventory, type PartKind } from '../game/parts.ts';
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
import { sampleWave } from './ocean.ts';
import { buildPart } from './part-sockets.ts';

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

  private readonly mounted: Record<PartKind, Object3D[]> = {
    engine: [],
    window: [],
    cannon: [],
    chimney: [],
    sail: [],
    moss: [],
    lantern: [],
    barrel: [],
  };
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
   * 인벤토리를 배에 반영한다. 얻은 파츠는 **전부** 붙는다 — 12개면 12개 다.
   * @param animateNew 새로 붙는 파츠를 팝 애니메이션으로 등장시킬지
   */
  setParts(inventory: Inventory, animateNew = false): void {
    for (const kind of PART_KINDS) {
      const want = inventory[kind];
      const list = this.mounted[kind];

      while (list.length > want) {
        const obj = list.pop();
        if (obj !== undefined) this.rig.remove(obj);
      }
      while (list.length < want) {
        const object = buildPart(kind, list.length);
        this.rig.add(object);
        list.push(object);
        if (animateNew) {
          this.popping.push({ object, t: 0, scale: object.scale.x });
          object.scale.setScalar(0.01);
        }
      }
    }
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
