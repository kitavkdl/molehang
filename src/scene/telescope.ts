import { ZOOM, clampZoom, framingFor, panLimit, zoomedFraming, type Framing } from './framing.ts';

/**
 * 망원경 — 배율과 화면 이동.
 *
 * 두 가지만 한다.
 *
 *   1. **배율.** 최소로 내리면 카메라가 뒤로 빠지며 화각이 열려 배가 망망대해의 점이 되고,
 *      최대로 올리면 화각만 좁아져 부품 하나를 뜯어볼 수 있다. (framing.ts 의 zoomedFraming)
 *   2. **이동.** 확대한 상태에서 끌면 화면이 따라온다.
 *
 * **회전은 없다.** 끌어도 카메라는 언제나 같은 쪽에서 배를 본다 —
 * 카메라와 시점이 **같은 양만큼 평행이동**할 뿐이다. 돌려서 반대편을 보는 조작은
 * 일부러 넣지 않았다. 이 배는 한쪽에서 보도록 만들어진 로우폴리 세트라
 * 뒤로 돌리면 갑판 뒷면과 텅 빈 우현이 나온다.
 *
 * 값만 들고 있고 카메라는 건드리지 않는다 — 카메라 조립은 world.ts 한 곳에서만 한다.
 */
export interface TelescopeHandlers {
  /** 다른 조작(부품 끌기)이 이 포인터를 이미 가져갔는가 */
  blocked: () => boolean;
}

/** 휠 한 칸이 배율을 얼마나 바꾸는가 */
const WHEEL_GAIN = 0.0016;
/** 이만큼은 움직여야 '끄는 중'으로 본다 — 탭이 화면을 밀어 버리지 않게 */
const DRAG_SLOP = 3;

export class Telescope {
  private zoomLevel: number = ZOOM.default;
  private panX = 0;
  private panY = 0;

  /** 지금 화면에 닿아 있는 손가락들 */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private dragging = false;
  private moved = 0;
  private lastX = 0;
  private lastY = 0;
  /** 두 손가락 벌리기 시작 시점의 간격과 배율 */
  private pinchSpan = 0;
  private pinchFrom = 1;

  private readonly listeners = new Set<(zoom: number) => void>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: TelescopeHandlers,
  ) {
    this.canvas.addEventListener('pointerdown', this.onDown);
    globalThis.addEventListener('pointermove', this.onMove);
    globalThis.addEventListener('pointerup', this.onUp);
    globalThis.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    globalThis.removeEventListener('pointermove', this.onMove);
    globalThis.removeEventListener('pointerup', this.onUp);
    globalThis.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  get zoom(): number {
    return this.zoomLevel;
  }

  /** 화면 축 기준 이동량 (가로, 세로) */
  get offsetX(): number {
    return this.panX;
  }

  get offsetY(): number {
    return this.panY;
  }

  onZoomChange(fn: (zoom: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setZoom(zoom: number): void {
    const next = clampZoom(zoom);
    if (next === this.zoomLevel) return;
    this.zoomLevel = next;
    // 배율을 낮추면 볼 수 있는 범위가 줄어든다. 이동량도 같이 당겨 와야
    // 배가 화면 밖에 남는 일이 없다
    this.clampPan();
    for (const fn of this.listeners) fn(next);
  }

  /** 기본 구도로 되돌린다 */
  reset(): void {
    this.panX = 0;
    this.panY = 0;
    this.setZoom(ZOOM.default);
  }

  /** 지금 배율의 구도 — world.ts 가 카메라에 옮겨 담는다 */
  framing(): Framing {
    const aspect = this.aspect();
    return zoomedFraming(framingFor(aspect), this.zoomLevel);
  }

  private aspect(): number {
    const h = globalThis.innerHeight || 1;
    return (globalThis.innerWidth || 1) / h;
  }

  /** 화면 1px 이 월드에서 몇인가 — 끄는 만큼 정확히 따라오게 하려면 필요하다 */
  private worldPerPixel(): number {
    const f = this.framing();
    const h = Math.max(1, globalThis.innerHeight || 1);
    return (2 * f.distance * Math.tan((f.fov * Math.PI) / 360)) / h;
  }

  private clampPan(): void {
    const limit = panLimit(this.zoomLevel);
    this.panX = Math.min(limit.x, Math.max(-limit.x, this.panX));
    this.panY = Math.min(limit.high, Math.max(limit.low, this.panY));
  }

  private readonly onDown = (e: PointerEvent): void => {
    // 부품을 집은 손가락이면 그쪽 것이다 (arrange.ts 가 먼저 받는다)
    if (this.handlers.blocked()) return;

    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.touches.size === 2) {
      this.dragging = false;
      this.pinchSpan = this.span();
      this.pinchFrom = this.zoomLevel;
      return;
    }
    if (this.touches.size !== 1) return;

    // 확대하지 않았으면 옮길 것이 없다 — 배 전체가 이미 화면에 있다
    if (panLimit(this.zoomLevel).x <= 0) return;
    this.dragging = true;
    this.moved = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private readonly onMove = (e: PointerEvent): void => {
    const touch = this.touches.get(e.pointerId);
    if (touch === undefined) return;
    touch.x = e.clientX;
    touch.y = e.clientY;

    if (this.touches.size >= 2) {
      if (this.pinchSpan > 0) this.setZoom((this.pinchFrom * this.span()) / this.pinchSpan);
      return;
    }
    if (!this.dragging) return;

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.moved < DRAG_SLOP) return;

    // 화면을 잡아 끄는 느낌 — 오른쪽으로 끌면 배가 오른쪽으로 온다.
    // 그러려면 카메라는 왼쪽으로 가야 한다
    const scale = this.worldPerPixel();
    this.panX -= dx * scale;
    this.panY += dy * scale;
    this.clampPan();
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinchSpan = 0;
    if (this.touches.size === 0) this.dragging = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.setZoom(this.zoomLevel * Math.exp(-e.deltaY * WHEEL_GAIN));
  };

  /** 두 손가락 사이 거리 */
  private span(): number {
    const [a, b] = [...this.touches.values()];
    if (a === undefined || b === undefined) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
