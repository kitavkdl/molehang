import { NoToneMapping, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import {
  createSkyState,
  evaluateSky,
  type SkyState,
  type TimeOfDaySource,
} from '../core/time-of-day.ts';
import type { Inventory } from '../game/parts.ts';
import { Motes } from '../fx/motes.ts';
import { Arrange } from './arrange.ts';
import { Birds } from './birds.ts';
import { Boat } from './boat.ts';
import { Clouds } from './clouds.ts';
import { setLampLight, updateFlatLighting } from './flat-material.ts';
import { Foam } from './foam.ts';
import { Islands } from './islands.ts';
import { Lights } from './lights.ts';
import { Ocean } from './ocean.ts';
import { ShadowBlob } from './shadow-blob.ts';
import { Sky } from './sky.ts';
import { Telescope } from './telescope.ts';
import { phaseColorsFor, type ThemeId } from '../style/themes.ts';

export interface LuminanceProbe {
  /** 화면 평균 휘도 0~1 */
  mean: number;
  /** 하위 10% 휘도 — "일부만 밝은" 화면을 걸러낸다 */
  p10: number;
}

export class World {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly boat: Boat;

  private readonly renderer: WebGLRenderer;
  private readonly ocean: Ocean;
  private readonly clouds: Clouds;
  private readonly islands: Islands;
  private readonly birds: Birds;
  private readonly lights: Lights;
  private readonly shadow: ShadowBlob;
  private readonly foam: Foam;
  private readonly motes: Motes;
  private readonly sky: Sky;
  private readonly arrange: Arrange;
  private readonly telescope: Telescope;
  private readonly state: SkyState = createSkyState();
  private readonly target = new Vector3();

  private arrangeDrop: (key: string, position: [number, number, number]) => void = () => {};
  private arrangePick: (key: string | null) => void = () => {};
  private arrangeSettle: (settling: boolean) => void = () => {};
  private themeColors = phaseColorsFor('classic');

  private elapsed = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = false;

  constructor(
    canvas: HTMLCanvasElement,
    private timeSource: TimeOfDaySource,
    private readonly options: { probe?: boolean } = {},
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.probe === true,
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    // 플랫하고 쨍한 색을 유지하려면 톤매핑을 끈다. (CLAUDE.md §3.3)
    this.renderer.toneMapping = NoToneMapping;

    this.camera = new PerspectiveCamera(40, 1, 0.1, 900);

    this.sky = new Sky();
    this.ocean = new Ocean();
    this.islands = new Islands();
    this.clouds = new Clouds();
    this.birds = new Birds();
    this.lights = new Lights();
    this.boat = new Boat();
    this.shadow = new ShadowBlob();
    this.foam = new Foam();
    this.motes = new Motes();

    this.scene.add(
      this.sky.mesh,
      this.lights.group,
      this.islands.group,
      this.ocean.group,
      this.clouds.group,
      this.birds.group,
      this.shadow.mesh,
      this.foam.group,
      this.boat.group,
      this.motes.group,
    );

    this.arrange = new Arrange(
      canvas,
      this.camera,
      this.boat.localSpace,
      () => this.boat.arrangeTargets,
      {
        onDrop: (key, position) => this.arrangeDrop(key, position),
        onPick: (key) => {
          this.boat.setPickedPart(key);
          this.arrangePick(key);
        },
        onSettle: (settling) => this.arrangeSettle(settling),
      },
    );

    // 망원경은 배치보다 **뒤에** 붙는다. 같은 캔버스의 pointerdown 을 둘이 듣는데,
    // 부품을 집은 손가락으로 화면까지 끌리면 부품이 손에서 도망간다.
    this.telescope = new Telescope(canvas, { blocked: () => this.arrange.isDragging });

    this.resize();
    globalThis.addEventListener('resize', this.resize);
  }

  /** 망원경 배율 (framing.ts 의 ZOOM 범위) */
  get zoom(): number {
    return this.telescope.zoom;
  }

  setZoom(zoom: number): void {
    this.telescope.setZoom(zoom);
  }

  resetView(): void {
    this.telescope.reset();
  }

  onZoomChange(fn: (zoom: number) => void): () => void {
    return this.telescope.onZoomChange(fn);
  }

  setTimeSource(source: TimeOfDaySource): void {
    this.timeSource = source;
  }

  setFill(fill: number): void {
    this.motes.setFill(fill);
  }

  /** 인벤토리를 배에 반영 */
  setParts(
    inventory: Inventory,
    animateNew = false,
    placements?: Record<string, [number, number, number]>,
  ): void {
    this.boat.setParts(inventory, animateNew, placements);
  }

  /** 배치 모드 켜기/끄기 — 드래그를 열고, 옮길 수 있는 부품에 테두리를 씌운다 */
  setArrangeMode(active: boolean): void {
    this.arrange.setActive(active);
    this.boat.setArrangeMode(active);
  }

  /**
   * 부품이 화면 어디에 찍히는지 (CSS 픽셀).
   * 배치 드래그를 자동 검증할 때 쓴다 — 좌표를 찍어 보지 않으면 테스트가 허공을 집는다.
   */
  partScreenPositions(): Array<{ key: string; x: number; y: number }> {
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;
    const v = new Vector3();
    return this.boat.arrangeTargets.map((target) => {
      target.object.getWorldPosition(v).project(this.camera);
      return {
        key: target.key,
        x: ((v.x + 1) / 2) * w,
        y: ((1 - v.y) / 2) * h,
      };
    });
  }

  /**
   * 부품이 배 로컬 어디에 앉아 있는지. 배치 물리를 자동 검증할 때 쓴다 —
   * 화면 좌표만으로는 "닿아 있는가"를 확인할 수 없다.
   */
  partPlacements(): Array<{ key: string; position: [number, number, number] }> {
    return this.boat.arrangeTargets.map((target) => ({
      key: target.key,
      position: [target.object.position.x, target.object.position.y, target.object.position.z],
    }));
  }

  onArrangeDrop(fn: (key: string, position: [number, number, number]) => void): void {
    this.arrangeDrop = fn;
  }

  onArrangePick(fn: (key: string | null) => void): void {
    this.arrangePick = fn;
  }

  onArrangeSettle(fn: (settling: boolean) => void): void {
    this.arrangeSettle = fn;
  }

  /** 배에 달린 등불 총량 — 밤에 배가 보이는 정도를 결정한다 */
  setLight(level: number): void {
    setLampLight(level);
  }

  /** 바다 테마 — 같은 팔레트를 다르게 조합한 색표로 갈아끼운다 */
  setTheme(id: ThemeId): void {
    this.themeColors = phaseColorsFor(id);
  }

  /** 수거 연출: 결정들이 갑판 상자로 빨려 들어가고 배가 튄다 */
  playCollect(): void {
    this.motes.burst(this.boat.collectTarget);
    this.boat.bounce();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** 한 프레임 강제 렌더 (스크린샷 프로브용) */
  renderOnce(): void {
    this.frame(1 / 60);
  }

  private frame(dt: number): void {
    this.elapsed += dt;

    evaluateSky(this.timeSource.hourOfDay(), this.state, this.themeColors);

    this.sky.update(this.state, this.elapsed);
    this.lights.update(this.state);
    updateFlatLighting(this.state);
    this.ocean.update(this.state, this.elapsed);
    this.islands.update(this.state);
    this.clouds.update(this.state, dt);
    this.birds.update(this.state, this.elapsed);
    this.boat.update(this.elapsed, dt);
    this.shadow.update(this.elapsed);
    this.foam.update(this.state, this.elapsed);
    this.motes.update(this.elapsed, dt, this.boat.collectTarget);

    const framing = this.telescope.framing();
    const zoom = this.telescope.zoom;

    // 아주 느린 카메라 흔들림 — 정적인 화면이 되지 않게.
    // 확대할수록 줄인다. 화각이 좁아지면 같은 흔들림도 화면에서 몇 배로 커져서,
    // 부품을 들여다보는 내내 화면이 출렁인다
    const steady = Math.min(1, 1 / zoom);
    const sway = Math.sin(this.elapsed * 0.13) * 0.3 * steady;
    const lift = Math.sin(this.elapsed * 0.19) * 0.09 * steady;

    // 확대하면 배의 파도 흔들림을 따라간다 — 망원경으로 배를 좇는 것처럼.
    // 안 그러면 4배에서는 배가 화면 밖으로 들락거린다
    const follow = Math.min(1, Math.max(0, zoom - 1)) * this.boat.group.position.y;

    // 이동은 화면 축으로 준다. 카메라와 시점을 **같은 양** 옮기므로 시선은 안 돈다
    const px = this.telescope.offsetX;
    const py = this.telescope.offsetY;

    this.camera.position.set(sway + px, framing.height + lift + py + follow, framing.distance);
    this.target.set(px, framing.targetY + py + follow, 0);
    this.camera.lookAt(this.target);
    this.sky.mesh.position.copy(this.camera.position);

    if (Math.abs(this.camera.fov - framing.fov) > 1e-3) {
      this.camera.fov = framing.fov;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.render(this.scene, this.camera);
  }

  private readonly resize = (): void => {
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = this.telescope.framing().fov;
    this.camera.updateProjectionMatrix();
  };

  /** 밝기 자동 검증용 (CLAUDE.md §3.4) */
  sampleLuminance(): LuminanceProbe | null {
    if (this.options.probe !== true) return null;
    this.renderOnce();

    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);

    const lums: number[] = [];
    let sum = 0;
    // 4픽셀마다 하나씩만 샘플링 — 충분하고 훨씬 빠르다
    for (let i = 0; i < px.length; i += 4 * 4) {
      const l = (0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!) / 255;
      lums.push(l);
      sum += l;
    }
    lums.sort((a, b) => a - b);
    return {
      mean: sum / lums.length,
      p10: lums[Math.floor(lums.length * 0.1)] ?? 0,
    };
  }

  dispose(): void {
    this.stop();
    this.arrange.dispose();
    this.telescope.dispose();
    globalThis.removeEventListener('resize', this.resize);
    this.sky.dispose();
    this.ocean.dispose();
    this.islands.dispose();
    this.clouds.dispose();
    this.birds.dispose();
    this.lights.dispose();
    this.boat.dispose();
    this.shadow.dispose();
    this.foam.dispose();
    this.motes.dispose();
    this.renderer.dispose();
  }
}
