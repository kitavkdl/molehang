import { NoToneMapping, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { createSkyState, evaluateSky, type SkyState, type TimeOfDaySource } from '../core/time-of-day.ts';
import { Motes } from '../fx/motes.ts';
import { Boat } from './boat.ts';
import { Clouds } from './clouds.ts';
import { updateFlatLighting } from './flat-material.ts';
import { framingFor } from './framing.ts';
import { Lights } from './lights.ts';
import { Ocean } from './ocean.ts';
import { ShadowBlob } from './shadow-blob.ts';
import { Sky } from './sky.ts';

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
  private readonly lights: Lights;
  private readonly shadow: ShadowBlob;
  private readonly motes: Motes;
  private readonly sky: Sky;
  private readonly state: SkyState = createSkyState();
  private readonly target = new Vector3();

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

    this.camera = new PerspectiveCamera(42, 1, 0.1, 900);

    this.sky = new Sky();
    this.ocean = new Ocean();
    this.clouds = new Clouds();
    this.lights = new Lights();
    this.boat = new Boat();
    this.shadow = new ShadowBlob();
    this.motes = new Motes();

    this.scene.add(
      this.sky.mesh,
      this.lights.group,
      this.ocean.group,
      this.clouds.group,
      this.shadow.mesh,
      this.boat.group,
      this.motes.group,
    );

    this.resize();
    globalThis.addEventListener('resize', this.resize);
  }

  setTimeSource(source: TimeOfDaySource): void {
    this.timeSource = source;
  }

  setFill(fill: number): void {
    this.motes.setFill(fill);
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

    evaluateSky(this.timeSource.hourOfDay(), this.state);

    this.sky.update(this.state, this.elapsed);
    this.lights.update(this.state);
    updateFlatLighting(this.state);
    this.ocean.update(this.state, this.elapsed);
    this.clouds.update(this.state, dt);
    this.boat.update(this.elapsed, dt);
    this.shadow.update(this.elapsed);
    this.motes.update(this.elapsed, dt, this.boat.collectTarget);

    // 아주 느린 카메라 흔들림 — 정적인 화면이 되지 않게
    const sway = Math.sin(this.elapsed * 0.13) * 0.34;
    const lift = Math.sin(this.elapsed * 0.19) * 0.11;
    const framing = framingFor(this.camera.aspect);
    this.camera.position.set(sway, framing.height + lift, framing.distance);
    this.target.set(0, framing.targetY, 0);
    this.camera.lookAt(this.target);
    this.sky.mesh.position.copy(this.camera.position);

    this.renderer.render(this.scene, this.camera);
  }

  private readonly resize = (): void => {
    const w = globalThis.innerWidth;
    const h = globalThis.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = framingFor(this.camera.aspect).fov;
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
    globalThis.removeEventListener('resize', this.resize);
    this.sky.dispose();
    this.ocean.dispose();
    this.clouds.dispose();
    this.lights.dispose();
    this.boat.dispose();
    this.shadow.dispose();
    this.motes.dispose();
    this.renderer.dispose();
  }
}
