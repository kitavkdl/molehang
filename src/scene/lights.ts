import { DirectionalLight, Group, HemisphereLight } from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { int } from '../style/palette.ts';

/**
 * 방향광 1개 + 헤미스피어 1개. 그 이상 추가 금지. (CLAUDE.md §3.3)
 * 섀도우맵은 쓰지 않는다 — 그림자는 shadow-blob.ts 의 연한 단색 블롭.
 *
 * 씬 대부분은 flat-material.ts 의 커스텀 셰이더로 그리는데, 그 셰이더도
 * **정확히 같은 파라미터**(방향광 1 + 헤미스피어 1)를 SkyState 에서 받아 쓴다.
 * 여기 실제 라이트를 남겨 두는 이유는 Lambert 머티리얼을 섞어 써도 색이 어긋나지 않게 하려는 것.
 */
export class Lights {
  readonly group = new Group();
  private readonly sun: DirectionalLight;
  private readonly hemi: HemisphereLight;

  constructor() {
    // 색은 매 프레임 시간대에 맞춰 갈아끼운다 — 여기 값은 첫 프레임용
    this.sun = new DirectionalLight(int('cream'), 1);
    this.sun.position.set(0, 1, 0);
    this.hemi = new HemisphereLight(int('ice'), int('wave'), 1);

    this.group.add(this.sun, this.sun.target, this.hemi);
    this.group.name = 'lights';
  }

  update(state: SkyState): void {
    this.sun.color.copy(state.sunLight);
    this.sun.intensity = state.sunIntensity;
    this.sun.position.copy(state.sunDir).multiplyScalar(60);

    this.hemi.color.copy(state.hemiSky);
    this.hemi.groundColor.copy(state.hemiGround);
    this.hemi.intensity = state.hemiIntensity;
  }

  dispose(): void {
    this.sun.dispose();
    this.hemi.dispose();
  }
}
