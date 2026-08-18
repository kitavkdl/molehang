import { Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';
import type { SkyState } from '../core/time-of-day.ts';
import { col, type PaletteKey } from '../style/palette.ts';

/**
 * 플랫 셰이딩 전용 머티리얼.
 *
 * 표준 Lambert 로는 광원 반대편 면이 갈색·회색으로 죽어버려 아트 방향이 무너진다.
 * 그래서 조명 모델을 직접 쓴다 — 면 색은 **팔레트 색의 80% 아래로 절대 내려가지 않는다.**
 * 셰이딩은 3단계 계단이고 스페큘러는 없다. (CLAUDE.md §3.2 / §3.4)
 *
 * 조명 파라미터(방향광 1 + 헤미스피어 1)는 lights.ts 의 실제 라이트와 같은 값을 공유한다.
 */

/** 모든 FlatMaterial 이 공유하는 조명 uniform — 프레임마다 한 번만 갱신하면 된다 */
const SHARED = {
  uLightDir: { value: new Vector3(0, 1, 0) },
  uLightColor: { value: new Color(1, 1, 1) },
  uHemiSky: { value: new Color(1, 1, 1) },
  uHemiGround: { value: new Color(1, 1, 1) },
  uPower: { value: 1 },
  /** 0 = 평소, 1 = 완전한 밤. 배를 어둠에 잠기게 한다 */
  uNight: { value: 0 },
  /** 배에 달린 등불이 만드는 빛 (0~1). 어둠을 걷어낸다 */
  uLamp: { value: 0 },
  /** 밤에 물드는 색 */
  uNightTint: { value: new Color(1, 1, 1) },
};

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uPower;
uniform float uNight;
uniform float uLamp;
uniform vec3 uNightTint;

varying vec3 vWorld;

void main() {
  // 면 노멀을 화면 미분으로 구한다 = 정점 노멀과 무관하게 언제나 완전한 플랫 셰이딩
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 viewDir = normalize(cameraPosition - vWorld);
  // 보이는 면은 항상 카메라를 향하도록 — 생성 지오메트리의 와인딩에 흔들리지 않는다
  if (dot(n, viewDir) < 0.0) n = -n;

  float lam = dot(n, normalize(uLightDir));
  float band = lam > 0.42 ? 1.0 : (lam > -0.12 ? 0.9 : 0.8);

  vec3 hemi = mix(uHemiGround, uHemiSky, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));

  vec3 c = uColor * band;
  c += uColor * uLightColor * 0.16 * uPower * step(0.42, lam);
  c = mix(c, uColor * hemi * 1.4, 0.15);

  // 밤 — 등불이 없으면 배가 어둠에 잠긴다.
  // 등불(uLamp)이 늘어날수록 원래 색을 되찾는다. 이게 등불을 다는 이유다.
  float dark = uNight * (1.0 - uLamp);
  c = mix(c, c * uNightTint * 0.3, dark);

  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/** 팔레트 키만 받는다 — 임의의 색을 만들 수 있는 경로 자체를 없앤다. (CLAUDE.md §3.1) */
export class FlatMaterial extends ShaderMaterial {
  constructor(key: PaletteKey) {
    super({
      uniforms: {
        uColor: { value: col(key) },
        ...SHARED,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      // 노멀을 카메라 쪽으로 뒤집어 쓰므로 와인딩이 어긋난 생성 지오메트리도
      // 그대로 그려져야 한다. FrontSide 로 두면 돛·갑판이 통째로 사라진다.
      side: DoubleSide,
    });
  }

  setColor(color: Color): this {
    (this.uniforms.uColor!.value as Color).copy(color);
    return this;
  }
}

/** 씬 코드는 이 단축 생성자만 쓴다 */
export function flat(key: PaletteKey): FlatMaterial {
  return new FlatMaterial(key);
}

/** 프레임마다 1회 — 공유 조명 uniform 갱신 */
export function updateFlatLighting(state: SkyState): void {
  SHARED.uLightDir.value.copy(state.sunDir);
  SHARED.uLightColor.value.copy(state.sunLight);
  SHARED.uHemiSky.value.copy(state.hemiSky);
  SHARED.uHemiGround.value.copy(state.hemiGround);
  SHARED.uPower.value = state.sunIntensity;
  SHARED.uNight.value = state.nightness;
  SHARED.uNightTint.value.copy(state.hemiGround);
}

/**
 * 배에 달린 등불의 총량을 반영한다.
 * 등불 0 → 밤에 배가 거의 안 보이고, 4개쯤이면 원래 색을 되찾는다.
 */
export function setLampLight(level: number): void {
  SHARED.uLamp.value = Math.min(1, level / 4);
}
