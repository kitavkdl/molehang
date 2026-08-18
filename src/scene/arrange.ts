import { Object3D, Plane, Raycaster, Vector2, Vector3, type Camera, type Group } from 'three';
import type { PartZone } from '../game/parts.ts';
import { ZONE_BOUNDS, clampToZone } from './part-sockets.ts';

/**
 * 배치 모드 — 부품을 끌어서 옮긴다.
 *
 * 자유 배치라고 해도 아무 데나 놓을 수는 없다. 부품은 자기 **구역** 안에서만 움직이고,
 * 구역 밖으로 끌면 경계에서 멈춘다. (part-sockets.ts 의 ZONE_BOUNDS)
 *
 * 드래그는 화면 좌표 → 월드 평면 → 배 로컬 좌표 순으로 옮긴다.
 * 배는 파도에 흔들리고 요(yaw)도 돌아가 있어서, 로컬로 되돌리지 않으면 좌표가 어긋난다.
 */
export interface ArrangeTarget {
  object: Group;
  key: string;
  zone: PartZone;
}

export interface ArrangeHandlers {
  /** 끌고 있는 동안(가벼움) */
  onMove?: (key: string, position: [number, number, number]) => void;
  /** 손을 뗐을 때 — 이때 저장한다 */
  onDrop: (key: string, position: [number, number, number]) => void;
  /** 무엇을 집었는지 (UI 힌트용). null 이면 놓음 */
  onPick?: (key: string | null) => void;
}

export class Arrange {
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly plane = new Plane();
  private readonly hit = new Vector3();
  private readonly grabOffset = new Vector3();

  private active = false;
  private dragging: ArrangeTarget | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    /** 배 로컬 좌표계 기준이 되는 그룹 (요·흔들림이 적용된 쪽) */
    private readonly body: Object3D,
    /** 지금 배에 붙어 있는 부품들 */
    private readonly targets: () => ArrangeTarget[],
    private readonly handlers: ArrangeHandlers,
  ) {
    this.canvas.addEventListener('pointerdown', this.onDown);
    globalThis.addEventListener('pointermove', this.onMove);
    globalThis.addEventListener('pointerup', this.onUp);
    globalThis.addEventListener('pointercancel', this.onUp);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.release();
  }

  get isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    globalThis.removeEventListener('pointermove', this.onMove);
    globalThis.removeEventListener('pointerup', this.onUp);
    globalThis.removeEventListener('pointercancel', this.onUp);
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.active) return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const targets = this.targets();
    const objects = targets.map((t) => t.object);
    const hits = this.raycaster.intersectObjects(objects, true);
    if (hits.length === 0) return;

    // 맞은 메시에서 위로 올라가 부품 그룹을 찾는다
    let node: Object3D | null = hits[0]!.object;
    let found: ArrangeTarget | undefined;
    while (node !== null && found === undefined) {
      found = targets.find((t) => t.object === node);
      node = node.parent;
    }
    if (found === undefined) return;

    e.preventDefault();
    this.dragging = found;
    this.setupPlane(found);

    // 집은 지점과 부품 원점의 차이를 유지해야 튀지 않는다
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit) !== null) {
      const local = this.body.worldToLocal(this.hit.clone());
      this.grabOffset.copy(found.object.position).sub(local);
    } else {
      this.grabOffset.set(0, 0, 0);
    }

    this.handlers.onPick?.(found.key);
  };

  /** 구역에 따라 끌리는 면을 정한다 */
  private setupPlane(target: ArrangeTarget): void {
    const world = target.object.getWorldPosition(new Vector3());
    const kind = ZONE_BOUNDS[target.zone].plane;

    if (kind === 'horizontal') {
      // 갑판·선미: 수평면 위를 미끄러진다
      this.plane.setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), world);
      return;
    }

    if (kind === 'sideways') {
      // 현측: 배의 옆면(로컬 X 법선)을 따라
      const normal = new Vector3(1, 0, 0)
        .applyQuaternion(this.body.getWorldQuaternion(target.object.quaternion.clone()))
        .normalize();
      this.plane.setFromNormalAndCoplanarPoint(normal, world);
      return;
    }

    // 돛대: 카메라를 바라보는 수직면 — 위아래로만 의미가 있다
    const toCamera = this.camera.getWorldPosition(new Vector3()).sub(world);
    toCamera.y = 0;
    if (toCamera.lengthSq() < 1e-6) toCamera.set(0, 0, 1);
    this.plane.setFromNormalAndCoplanarPoint(toCamera.normalize(), world);
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.active || this.dragging === null) return;
    e.preventDefault();

    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit) === null) return;

    const local = this.body.worldToLocal(this.hit.clone()).add(this.grabOffset);
    const clamped = clampToZone(this.dragging.zone, local.x, local.y, local.z);
    this.dragging.object.position.set(clamped[0], clamped[1], clamped[2]);
    this.handlers.onMove?.(this.dragging.key, clamped);
  };

  private readonly onUp = (): void => {
    if (this.dragging === null) return;
    const { key, object } = this.dragging;
    this.dragging = null;
    this.handlers.onDrop(key, [object.position.x, object.position.y, object.position.z]);
    this.handlers.onPick?.(null);
  };

  private release(): void {
    this.dragging = null;
    this.handlers.onPick?.(null);
  }
}
