/**
 * 카메라 프레이밍 — 씬 배치의 단일 출처. (CLAUDE.md §4.1)
 *
 * 무한의 바다에서는 화면을 나누는 선이 **수평선 하나**뿐이다.
 * 위는 하늘(구름·해/달), 아래는 바다(반사 길), 그 경계에 먼 섬 실루엣이 걸린다.
 * 구름·새·섬은 전부 여기 값에서 자기 높이를 계산하므로,
 * 카메라를 바꾸면 하늘 요소들이 알아서 따라온다.
 */
export interface Framing {
  fov: number;
  height: number;
  distance: number;
  targetY: number;
}

/** 세로 — 배가 화면 폭의 80% 정도를 차지하고 수평선은 위쪽 1/3 */
export const PORTRAIT: Framing = { fov: 40, height: 3.4, distance: 20, targetY: 1.35 };

/** 가로/PC — 더 가깝게 붙어 배가 히어로가 되도록 */
export const LANDSCAPE: Framing = { fov: 32, height: 3.2, distance: 17, targetY: 1.35 };

export const PORTRAIT_MAX_ASPECT = 0.85;

export function framingFor(aspect: number): Framing {
  return aspect < PORTRAIT_MAX_ASPECT ? PORTRAIT : LANDSCAPE;
}

const DEG = Math.PI / 180;

/**
 * 카메라에서 depth 만큼 떨어진 곳에서, 수평선 위 elevation(도) 에 놓이는 높이.
 * 구름·새를 "보이는 하늘 띠" 안에 정확히 앉히는 데 쓴다.
 */
export function skyY(depth: number, elevationDeg: number): number {
  return PORTRAIT.height + depth * Math.tan(elevationDeg * DEG);
}

/** 세로 화면에서 수평선 위로 보이는 최대 고도(도) — 이보다 높으면 화면 밖 */
export function maxVisibleElevation(): number {
  const pitchDown = Math.atan2(PORTRAIT.height - PORTRAIT.targetY, PORTRAIT.distance) / DEG;
  return PORTRAIT.fov / 2 - pitchDown;
}

// ---------------------------------------------------------------------------
// 망원경 — 배율과 이동 (CLAUDE.md §4.8)
// ---------------------------------------------------------------------------

/**
 * 배율 1 이 위의 기본 구도다. 0.4 가 가장 넓게, 4 가 가장 좁게 본다.
 *
 * 최소 배율에서 배는 화면의 한 점이 되고, 남는 자리를 전부 바다와 하늘이 채운다.
 * 그게 "망망대해" 다 — 배를 줄이는 게 목적이 아니라 **주변을 늘리는** 게 목적이다.
 */
export const ZOOM = { min: 0.4, max: 4, default: 1 } as const;

/**
 * 배율에서 구도를 만든다. **키울 때와 줄일 때가 대칭이 아니다.**
 *
 * 키울 때는 카메라를 그대로 두고 화각만 좁힌다 — 그게 진짜 망원경이고,
 * 원근이 변하지 않아 부품이 아까 보던 그 모양 그대로 커진다.
 *
 * 줄일 때 화각만 넓히면 어안 렌즈가 되어 근경 바다가 화면 절반을 먹는다.
 * (실제로 그렇게 만들었다가 되돌렸다.) 그래서 카메라를 같이 뒤로 뺀다 —
 * 화각은 완만하게, 거리는 넉넉하게. 왜곡 없이 배만 작아진다.
 */
export function zoomedFraming(base: Framing, zoom: number): Framing {
  const out = 1 / clampZoom(zoom);
  const pull = zoom >= 1 ? 1 : out ** 0.7;
  const spread = zoom >= 1 ? out : out ** 0.5;
  return {
    fov: (2 * Math.atan(Math.tan(((base.fov * DEG) / 2)) * spread)) / DEG,
    height: base.height,
    distance: base.distance * pull,
    targetY: base.targetY,
  };
}

export function clampZoom(zoom: number): number {
  return zoom < ZOOM.min ? ZOOM.min : zoom > ZOOM.max ? ZOOM.max : zoom;
}

/**
 * 확대한 채로 화면을 옮길 수 있는 범위 (배 로컬이 아니라 **화면 축** 기준).
 *
 * 배율 1 에서는 배 전체가 이미 보이므로 0 이다 — 옮길 이유가 없는데 옮겨지면
 * 그냥 배를 잃어버린다. 배율이 올라갈수록 열린다.
 *
 * 위쪽을 크게 잡은 이유: 돛대 구역은 부품이 위로만 쌓여서, 12개쯤 받으면
 * 갑판보다 훨씬 높은 곳에 탑이 선다. 거기까지 닿아야 한다.
 */
const PAN = { x: 3.4, down: -1.6, up: 9 } as const;

export function panLimit(zoom: number): { x: number; low: number; high: number } {
  const open = Math.min(1, Math.max(0, (clampZoom(zoom) - 1) / (ZOOM.max - 1)));
  return { x: PAN.x * open, low: PAN.down * open, high: PAN.up * open };
}
