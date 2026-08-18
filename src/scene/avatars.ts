import { CylinderGeometry, Group, Mesh, OctahedronGeometry, type BufferGeometry } from 'three';
import type { AvatarSpec } from '../game/avatar.ts';
import type { PaletteKey } from '../style/palette.ts';
import { flat, type FlatMaterial } from './flat-material.ts';
import { boxGeometry, hullDeckAt } from './hull.ts';

/**
 * 갑판 위의 선장들.
 *
 * 첫 번째는 언제나 **나**다. 선단으로 같이 접속해 있는 동안에는 선원들의 아바타가
 * 뒤이어 나란히 선다 — "쟤가 지금 내 배에 타 있다"가 화면에 보이는 것이 목적이다.
 * 떠나면(하트비트 끊김) 사라진다. 같이 있는 동안만 보이는 것이 선단의 원칙이다. (§4.3)
 *
 * 배치 물리(part-support.ts)와는 무관하다 — 아바타는 부품이 아니라 사람이라
 * 자리를 먹지 않고, 끌 수도 없다. 서는 자리는 부품 격자·상자·돛대를 피해 골랐다.
 *
 * 색은 전부 팔레트 키다. 옷 색 id(game/avatar.ts)가 곧 팔레트 키라서
 * 새 색이 생길 길이 없다.
 */

/** 서는 자리 (배 로컬 x, z) — CREW_MAX(4)명분. 상자(z=-1.6)와 돛대(z=0.5)를 피한다 */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 1.95],
  [-0.55, 1.1],
  [0.58, -0.6],
  [-0.5, -2.4],
];

/** 모자마다 정해진 색 — 옷과 따로 놀아야 실루엣이 읽힌다 */
const HAT_COLORS: Record<string, PaletteKey> = {
  cap: 'wave',
  tricorn: 'rust',
  bucket: 'sun',
};

export class Avatars {
  readonly group = new Group();

  private readonly materials = new Map<PaletteKey, FlatMaterial>();
  private readonly geometries: BufferGeometry[] = [];
  private figures: Group[] = [];
  private baseY: number[] = [];
  private signature = '';

  constructor() {
    this.group.name = 'avatars';
  }

  /** [나, ...선원들] 순서. 같은 구성이면 아무것도 안 한다 */
  setCrew(specs: readonly AvatarSpec[]): void {
    const roster = specs.slice(0, SPOTS.length);
    const signature = JSON.stringify(roster);
    if (signature === this.signature) return;
    this.signature = signature;

    for (const fig of this.figures) this.group.remove(fig);
    this.figures = [];
    this.baseY = [];

    roster.forEach((spec, i) => {
      const [x, z] = SPOTS[i]!;
      const figure = this.buildFigure(spec);
      // 발바닥이 그 자리의 갑판선 위에 오게 — 갑판은 뱃머리로 갈수록 들린다
      const y = hullDeckAt(z) + 0.02;
      figure.position.set(x, y, z);
      // 전부 정면(카메라 쪽)이면 마네킹 같다 — 조금씩 다른 곳을 본다
      figure.rotation.y = (i * 2.1 + 0.6) % (Math.PI / 2) - Math.PI / 4;
      this.group.add(figure);
      this.figures.push(figure);
      this.baseY.push(y);
    });
  }

  /** 가만히 서 있지 않고 아주 살짝 들썩인다 — 사람이 서 있다는 신호 */
  update(elapsed: number): void {
    for (let i = 0; i < this.figures.length; i++) {
      const fig = this.figures[i]!;
      fig.position.y = this.baseY[i]! + Math.abs(Math.sin(elapsed * 1.7 + i * 1.9)) * 0.025;
      fig.rotation.z = Math.sin(elapsed * 0.9 + i * 2.3) * 0.03;
    }
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

  /** 발 원점 기준의 작은 사람 — 다리·몸통·팔·머리·모자 */
  private buildFigure(spec: AvatarSpec): Group {
    const g = new Group();
    // 옷 색 id 는 곧 팔레트 키다 (game/avatar.ts)
    const outfit = this.material(spec.outfit as PaletteKey);
    const skin = this.material('cream');
    const pants = this.material('indigo');

    const add = (geo: BufferGeometry, mat: FlatMaterial, y: number, x = 0, z = 0): Mesh => {
      const mesh = new Mesh(geo, mat);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };

    add(this.keep(boxGeometry(0.17, 0.15, 0.11)), pants, 0.075);
    add(this.keep(boxGeometry(0.23, 0.27, 0.14)), outfit, 0.28);
    add(this.keep(boxGeometry(0.055, 0.2, 0.07)), outfit, 0.3, 0.15);
    add(this.keep(boxGeometry(0.055, 0.2, 0.07)), outfit, 0.3, -0.15);
    add(this.keep(new OctahedronGeometry(0.115, 0)), skin, 0.53);

    switch (spec.hat) {
      case 'cap': {
        add(this.keep(new CylinderGeometry(0.085, 0.09, 0.075, 7)), this.material(HAT_COLORS.cap!), 0.645);
        add(this.keep(boxGeometry(0.11, 0.025, 0.09)), this.material(HAT_COLORS.cap!), 0.615, 0, 0.1);
        break;
      }
      case 'tricorn': {
        // 3각 실린더 = 삼각모의 실루엣
        const brim = add(
          this.keep(new CylinderGeometry(0.13, 0.15, 0.045, 3)),
          this.material(HAT_COLORS.tricorn!),
          0.63,
        );
        brim.rotation.y = Math.PI / 6;
        add(this.keep(new OctahedronGeometry(0.06, 0)), this.material(HAT_COLORS.tricorn!), 0.67);
        break;
      }
      case 'bucket': {
        add(this.keep(new CylinderGeometry(0.07, 0.13, 0.09, 7)), this.material(HAT_COLORS.bucket!), 0.645);
        break;
      }
      case 'none':
        break;
    }

    return g;
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    for (const m of this.materials.values()) m.dispose();
  }
}
