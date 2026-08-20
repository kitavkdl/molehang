import { NoToneMapping, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import {
  createSkyState,
  evaluateSky,
  type SkyState,
  type TimeOfDaySource,
} from '../core/time-of-day.ts';
import type { AvatarOutfit, AvatarSpec } from '../game/avatar.ts';
import type { Inventory } from '../game/parts.ts';
import { Motes } from '../fx/motes.ts';
import { Arrange } from './arrange.ts';
import { Avatars } from './avatars.ts';
import { Birds } from './birds.ts';
import { Boat } from './boat.ts';
import { Clouds } from './clouds.ts';
import { CrewShips } from './crew-ships.ts';
import { setLampLight, updateFlatLighting } from './flat-material.ts';
import { Foam } from './foam.ts';
import { Islands } from './islands.ts';
import { Lights } from './lights.ts';
import { Ocean } from './ocean.ts';
import { ShadowBlob } from './shadow-blob.ts';
import { Sky } from './sky.ts';
import { Telescope } from './telescope.ts';
import { Voyage } from './voyage.ts';
import { Wake } from './wake.ts';
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
  private readonly voyage: Voyage;
  private readonly wake: Wake;
  private readonly avatars: Avatars;
  private readonly crewShips: CrewShips;
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
  /** 속도감 카메라 당김 0~1 — 달리면 카메라가 살짝 물러난다. 급변하지 않게 여기서 눅인다 */
  private speedPull = 0;

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

    this.voyage = new Voyage(canvas);
    this.wake = new Wake();
    // 암초 충돌 — 배가 부르르 떤다. (카메라 흔들림은 frame 이 voyage.shake 로 얹는다)
    this.voyage.onHit(() => this.boat.jolt());

    // 아바타는 배 로컬 그룹에 태운다 — 파도 흔들림과 요(yaw)를 배와 같이 탄다
    this.avatars = new Avatars();
    this.boat.localSpace.add(this.avatars.group);

    // 동행선은 씬(월드) 공간이다 — 내 배와 따로, 자기 파도를 타야 한다
    this.crewShips = new CrewShips();

    this.scene.add(
      this.sky.mesh,
      this.lights.group,
      this.islands.group,
      this.ocean.group,
      this.crewShips.group,
      this.voyage.group,
      this.clouds.group,
      this.birds.group,
      this.shadow.mesh,
      this.foam.group,
      this.wake.group,
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
    // 항해 중에는 끌기가 타륜이다 — 망원경 이동은 양보한다.
    this.telescope = new Telescope(canvas, {
      blocked: () => this.arrange.isDragging || this.voyage.active,
    });

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

  /** 갑판 위에 설 선장들 — 첫 번째가 나, 나머지는 접속 중인 선원들 */
  setAvatars(specs: readonly AvatarSpec[]): void {
    this.avatars.setCrew(specs);
  }

  /** 동행선 — 접속 중인 선원들의 배가 내 바다에 같이 떠 있다 (§4.3) */
  setCrewShips(members: ReadonlyArray<{ id: string; outfit: AvatarOutfit }>): void {
    this.crewShips.setCrew(members);
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
   * 항해모드 켜기/끄기.
   * 켤 때 망원경을 기본 구도로 되돌린다 — 4배로 부품을 들여다보는 채로
   * 배가 달리기 시작하면 무슨 일이 나는지 알 수 없는 화면이 된다.
   */
  setVoyageMode(active: boolean): void {
    if (active) this.telescope.reset();
    this.voyage.setActive(active);
  }

  get voyageActive(): boolean {
    return this.voyage.active;
  }

  /** 지금 물살을 가르는 속도 (유닛/초) — 항해 UI 의 속도계가 읽는다 */
  get voyageSpeed(): number {
    return this.voyage.speed;
  }

  /** 선체 내구도 0~1 — 항해 UI 의 게이지가 읽는다 */
  get voyageHull(): number {
    return this.voyage.hullIntegrity;
  }

  /** 지금 낼 수 있는 최고 속도 — 항해 UI 속도 게이지의 분모 */
  get voyageMaxSpeed(): number {
    return this.voyage.maxSpeed;
  }

  /** 항로 위험도 0~1 — 항해 UI 의 "전방 암초!" 배지가 읽는다 */
  get voyageDanger(): number {
    return this.voyage.danger;
  }

  /** 이번 항해 누적 거리 (유닛) */
  get voyageTrip(): number {
    return this.voyage.tripDistance;
  }

  /** 화면 조이스틱 상태 — 항해 UI 가 누른 자리에 스틱을 그린다 */
  voyageStick(): { active: boolean; x: number; y: number; dx: number; dy: number } {
    return this.voyage.stickPose();
  }

  /** 뱃머리 방향 (라디안) — 자동 검증용 */
  get voyageHeading(): number {
    return this.voyage.heading;
  }

  /** 체이스 캠 각 (라디안) — 자동 검증용 */
  get voyageViewYaw(): number {
    return this.voyage.viewYaw;
  }

  /** 부품 효과(엔진·돛·외륜)에서 오는 항해 속도 보너스 */
  setVoyageSpeed(bonus: number): void {
    this.voyage.speedBonus = bonus;
  }

  /** 배 무게 (parts.ts shipHeft) — 항해 드래그와 흘수(물에 잠기는 깊이)에 쓴다 */
  setShipHeft(heft: number): void {
    this.voyage.heft = heft;
  }

  /** 암초에 부딪혔다 — main 이 받아 따개비를 붙인다 */
  onReefHit(fn: () => void): () => void {
    return this.voyage.onHit(fn);
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

    // 항해 — 배는 원점에 있고 바다가 흐른다. 모두가 같은 바다 좌표를 봐야
    // 배·그림자·포말이 같은 물결을 탄다.
    this.voyage.update(dt, this.elapsed);
    const seaX = this.voyage.seaX;
    const seaZ = this.voyage.seaZ;

    this.sky.update(this.state, this.elapsed);
    this.lights.update(this.state);
    updateFlatLighting(this.state);
    this.ocean.update(this.state, this.elapsed, seaX, seaZ);
    this.islands.update(this.state);
    this.clouds.update(this.state, dt);
    this.birds.update(this.state, this.elapsed);
    this.boat.update(
      this.elapsed,
      dt,
      seaX,
      seaZ,
      this.voyage.vx,
      this.voyage.vz,
      this.voyage.heading,
    );
    this.avatars.update(this.elapsed);
    this.crewShips.update(this.elapsed, dt, seaX, seaZ, this.voyage.heading);
    this.shadow.update(this.elapsed, seaX, seaZ, this.voyage.heading);
    this.foam.update(this.state, this.elapsed, seaX, seaZ, this.voyage.heading);
    this.wake.update(this.state, this.elapsed, dt, seaX, seaZ, this.voyage.vx, this.voyage.vz);
    this.motes.update(this.elapsed, dt, this.boat.collectTarget, seaX, seaZ);

    const framing = this.telescope.framing();
    const zoom = this.telescope.zoom;

    // 아주 느린 카메라 흔들림 — 정적인 화면이 되지 않게.
    // 확대할수록 줄인다. 화각이 좁아지면 같은 흔들림도 화면에서 몇 배로 커져서,
    // 부품을 들여다보는 내내 화면이 출렁인다
    const steady = Math.min(1, 1 / zoom);
    const sway = Math.sin(this.elapsed * 0.13) * 0.3 * steady;
    const lift = Math.sin(this.elapsed * 0.19) * 0.09 * steady;

    // 속도감 — 달리면 카메라가 살짝 물러나며 높아진다. 정박하면 제자리로 눅는다.
    // §4.1 기본 구도의 개정이 아니라 체이스 캠(항해 한정) 위에 얹는 연출이다
    const pullTarget = this.voyage.active ? Math.min(1, this.voyage.speed / 6.5) : 0;
    this.speedPull += (pullTarget - this.speedPull) * Math.min(1, dt * 1.6);

    // 충돌 흔들림 — 암초에 부딪힌 직후 짧고 빠르게 떤다 (voyage.shake 가 지수감쇠)
    const quake = this.voyage.shake * steady;
    const quakeX = quake * 0.3 * Math.sin(this.elapsed * 53);
    const quakeY = quake * 0.22 * Math.sin(this.elapsed * 47 + 1.7);

    // 확대하면 배의 파도 흔들림을 따라간다 — 망원경으로 배를 좇는 것처럼.
    // 안 그러면 4배에서는 배가 화면 밖으로 들락거린다
    const follow = Math.min(1, Math.max(0, zoom - 1)) * this.boat.group.position.y;

    // 이동은 화면 축으로 준다. 카메라와 시점을 **같은 양** 옮기므로 시선은 안 돈다
    const px = this.telescope.offsetX;
    const py = this.telescope.offsetY;

    // 항해 체이스 캠 — 카메라 자리와 시점을 배(원점) 둘레로 같이 돌린다.
    // 정박해 있으면 viewYaw 가 0 으로 풀려 §4.1 기본 구도 그대로다.
    const yaw = this.voyage.viewYaw;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const camX = sway + px + quakeX;
    const camZ = framing.distance * (1 + 0.1 * this.speedPull);
    this.camera.position.set(
      camX * cy + camZ * sy,
      framing.height + lift + py + follow + quakeY + 0.5 * this.speedPull,
      -camX * sy + camZ * cy,
    );
    this.target.set(px * cy, framing.targetY + py + follow + quakeY * 0.5, -px * sy);
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
    this.voyage.dispose();
    this.wake.dispose();
    this.avatars.dispose();
    this.crewShips.dispose();
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
